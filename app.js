class OscilineEffect {
    constructor() {
        this.time = 0;
        this.container = document.getElementById('container');
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.renderer = new THREE.WebGLRenderer();
        this.container.appendChild(this.renderer.domElement);

        this.detectionData = null;
        this.detectionTexture = null;
        this.loadDetectionModel();
        
        this.setupScene();
        this.setupControls();
        this.setupExport();
        this.setupDragAndDock();
        this.animate();
        this.handleResize();

        this.lastUpdateTime = 0;
        this.smoothedValues = {
            baseAmplitude: 0.0,
            baseFrequency: 0.0,
            waveComplexity: 0.0,
            desyncAmount: 0.0
        };

        this.isRecording = false;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.aspectRatio = 16/9; // Default aspect ratio
    }

    async loadDetectionModel() {
        this.model = await cocoSsd.load();
        document.getElementById('status').textContent = 'Model loaded';
        this.loadDefaultImage();
    }

    setupScene() {
        const geometry = new THREE.PlaneGeometry(2, 2);
        this.detectionTexture = new THREE.DataTexture(
            new Float32Array(1024 * 4), // 1024 possible detections
            1024,
            1,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                tDetections: { value: this.detectionTexture },
                rows: { value: 100.0 },
                weight: { value: 0.5 },  // Default to medium-thin line
                brightness: { value: 1.0 },
                numDetections: { value: 0 },
                time: { value: 0.0 },
                baseAmplitude: { value: 0.0 },  // 20/1000
                baseFrequency: { value: 0.0 },   // 20/10
                waveComplexity: { value: 0.0 },
                desyncAmount: { value: 0.0 },    // 20/100
                resolution: { value: new THREE.Vector2() },
                lineColor: { value: new THREE.Vector3(0, 1, 0.2) }, // Default green color
                backgroundColor: { value: new THREE.Vector3(0, 0, 0) } // Default black
            },
            vertexShader: this.getVertexShader(),
            fragmentShader: this.getFragmentShader()
        });
        
        this.quad = new THREE.Mesh(geometry, this.material);
        this.scene.add(this.quad);

        window.addEventListener('resize', () => this.handleResize());

        // Set renderer precision
        this.renderer.setPixelRatio(window.devicePixelRatio);
    }

    setupControls() {
        const fileInput = document.getElementById('fileInput');
        fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

        // Basic controls
        document.getElementById('rows').addEventListener('input', (e) => {
            this.material.uniforms.rows.value = parseFloat(e.target.value);
        });

        document.getElementById('weight').addEventListener('input', (e) => {
            this.material.uniforms.weight.value = parseFloat(e.target.value);
        });

        document.getElementById('brightness').addEventListener('input', (e) => {
            this.material.uniforms.brightness.value = parseFloat(e.target.value) / 100;
        });

        // Wave controls
        const smoothControl = (id, uniformName, scale = 1) => {
            const element = document.getElementById(id);
            let updateTimer;
            
            element.addEventListener('input', (e) => {
                clearTimeout(updateTimer);
                const targetValue = parseFloat(e.target.value) / scale;
                
                // Start smooth transition
                const startValue = this.smoothedValues[uniformName];
                const startTime = performance.now();
                const duration = 100; // 100ms transition
                
                const animate = () => {
                    const now = performance.now();
                    const progress = Math.min((now - startTime) / duration, 1);
                    
                    // Smooth interpolation
                    this.smoothedValues[uniformName] = startValue + (targetValue - startValue) * progress;
                    this.material.uniforms[uniformName].value = this.smoothedValues[uniformName];
                    
                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    }
                };
                
                animate();
            });
        };

        // Apply smooth controls
        smoothControl('baseAmplitude', 'baseAmplitude', 1000);
        smoothControl('baseFrequency', 'baseFrequency', 10);
        smoothControl('waveComplexity', 'waveComplexity', 1);
        smoothControl('desyncAmount', 'desyncAmount', 100);

        // Add color control
        document.getElementById('lineColor').addEventListener('input', (e) => {
            const color = e.target.value;
            // Convert hex to RGB
            const r = parseInt(color.substr(1,2), 16) / 255;
            const g = parseInt(color.substr(3,2), 16) / 255;
            const b = parseInt(color.substr(5,2), 16) / 255;
            this.material.uniforms.lineColor.value.set(r, g, b);
        });

        // Add background color control
        document.getElementById('bgColor').addEventListener('input', (e) => {
            const color = e.target.value;
            const r = parseInt(color.substr(1,2), 16) / 255;
            const g = parseInt(color.substr(3,2), 16) / 255;
            const b = parseInt(color.substr(5,2), 16) / 255;
            this.material.uniforms.backgroundColor.value.set(r, g, b);
        });
    }

    setupExport() {
        document.getElementById('exportSvg').addEventListener('click', () => this.exportHighQualitySVG());

        // Add video recording
        const recordButton = document.getElementById('recordVideo');
        recordButton.addEventListener('click', () => this.toggleRecording());
    }

    exportSVG() {
        try {
            // Get dimensions and colors
            const canvas = this.renderer.domElement;
            const width = canvas.width;
            const height = canvas.height;
            const lineWeight = Math.max(0.5, this.material.uniforms.weight.value);
            const rows = this.material.uniforms.rows.value;
            const spacing = height / rows;
            
            // Get colors from material uniforms
            const bgColor = this.material.uniforms.backgroundColor.value;
            const lineColor = this.material.uniforms.lineColor.value;
            
            const bgHexColor = '#' + 
                Math.floor(bgColor.x * 255).toString(16).padStart(2, '0') +
                Math.floor(bgColor.y * 255).toString(16).padStart(2, '0') +
                Math.floor(bgColor.z * 255).toString(16).padStart(2, '0');
                
            const lineHexColor = '#' + 
                Math.floor(lineColor.x * 255).toString(16).padStart(2, '0') +
                Math.floor(lineColor.y * 255).toString(16).padStart(2, '0') +
                Math.floor(lineColor.z * 255).toString(16).padStart(2, '0');
            
            // Create a high-resolution PNG
            const dataURL = canvas.toDataURL('image/png');
            
            // Start SVG with background and viewBox
            let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
                <rect width="100%" height="100%" fill="${bgHexColor}"/>
                <style>image { width: 100%; height: 100%; } path { stroke: ${lineHexColor}; stroke-width: ${lineWeight}px; fill: none; }</style>
                <image href="${dataURL}" />
            `;
            
            // Add SVG filters to extract lines
            svg += `
                <filter id="extractLines">
                    <feColorMatrix type="matrix" values="0 0 0 0 0
                                                        0 0 0 0 0
                                                        0 0 0 0 0
                                                        1 1 1 0 0" />
                    <feComponentTransfer>
                        <feFuncR type="linear" slope="10" intercept="-4"/>
                        <feFuncG type="linear" slope="10" intercept="-4"/>
                        <feFuncB type="linear" slope="10" intercept="-4"/>
                    </feComponentTransfer>
                </filter>
                <g filter="url(#extractLines)">
                    <rect width="${width}" height="${height}" fill="none" />
                </g>
            `;
            
            svg += '</svg>';
            
            // Download SVG
            const blob = new Blob([svg], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = 'osciline.svg';
            link.href = url;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('SVG export failed:', error);
        }
    }

    exportHighQualitySVG() {
        // Show export status
        const statusEl = document.getElementById('status');
        const originalStatus = statusEl.textContent;
        statusEl.textContent = 'Generating SVG...';
        
        // Use setTimeout to allow UI to update before starting heavy work
        setTimeout(() => {
            try {
                // Get dimensions and settings
                const width = this.renderer.domElement.width;
                const height = this.renderer.domElement.height;
                const rows = Math.min(300, this.material.uniforms.rows.value); // Limit rows for performance
                const spacing = height / rows;
                const lineWeight = Math.max(0.5, this.material.uniforms.weight.value);
                
                // Get colors
                const bgColor = this.material.uniforms.backgroundColor.value;
                const lineColor = this.material.uniforms.lineColor.value;
                
                const bgHexColor = '#' + 
                    Math.floor(bgColor.x * 255).toString(16).padStart(2, '0') +
                    Math.floor(bgColor.y * 255).toString(16).padStart(2, '0') +
                    Math.floor(bgColor.z * 255).toString(16).padStart(2, '0');
                    
                const lineHexColor = '#' + 
                    Math.floor(lineColor.x * 255).toString(16).padStart(2, '0') +
                    Math.floor(lineColor.y * 255).toString(16).padStart(2, '0') +
                    Math.floor(lineColor.z * 255).toString(16).padStart(2, '0');
                
                // Start SVG
                let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
                    <rect width="100%" height="100%" fill="${bgHexColor}"/>
                    <style>path { stroke: ${lineHexColor}; stroke-width: ${lineWeight}px; fill: none; }</style>`;
                
                // For performance, create paths in batches
                const batchSize = 10;
                let currentBatch = 0;
                const totalBatches = Math.ceil(rows / batchSize);
                
                const generateBatch = () => {
                    const startRow = currentBatch * batchSize;
                    const endRow = Math.min(startRow + batchSize, rows);
                    
                    // Process one batch of rows
                    for (let i = endRow - 1; i >= startRow; i--) {
                        const y = i * spacing;
                        let pathPoints = [];
                        
                        // Sample less points for better performance
                        const step = Math.max(1, Math.floor(width / 300));
                        
                        for (let x = 0; x < width; x += step) {
                            const uv = { x: x / width, y: y / height };
                            const wave = this.calculateWaveAtPoint(uv, i);
                            const disruption = this.material.uniforms.tDiffuse.value ? 
                                this.calculateImageDisruptionAtPoint(uv) : 0;
                            
                            // FIX: Invert disruption direction to match screen rendering
                            const finalY = y + wave * height - disruption * height; // Note the negative sign
                            
                            pathPoints.push(`${x},${finalY.toFixed(1)}`);
                        }
                        
                        if (pathPoints.length > 1) {
                            svg += `<path d="M ${pathPoints.join(' L ')}" />`;
                        }
                    }
                    
                    currentBatch++;
                    
                    // Update status
                    statusEl.textContent = `Generating SVG... ${Math.floor((currentBatch/totalBatches) * 100)}%`;
                    
                    if (currentBatch < totalBatches) {
                        // Process next batch in next animation frame
                        requestAnimationFrame(generateBatch);
                    } else {
                        // Finalize and download SVG
                        svg += '</svg>';
                        
                        const blob = new Blob([svg], { type: 'image/svg+xml' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.download = 'osciline.svg';
                        link.href = url;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        
                        // Reset status
                        statusEl.textContent = originalStatus;
                    }
                };
                
                // Start batch processing
                generateBatch();
                
            } catch (error) {
                console.error('SVG export failed:', error);
                statusEl.textContent = 'SVG export failed';
                setTimeout(() => { statusEl.textContent = originalStatus; }, 3000);
            }
        }, 100); // Short delay to update UI
    }
    
    calculateImageDisruptionAtPoint(uv) {
        try {
            if (!this.material.uniforms.tDiffuse.value) return 0;
            
            // For video textures
            if (this.material.uniforms.tDiffuse.value.isVideoTexture) {
                const video = this.material.uniforms.tDiffuse.value.image;
                if (!video || video.videoWidth === 0) return 0;
                
                // Cache canvas for performance
                if (!this._videoCanvas) {
                    this._videoCanvas = document.createElement('canvas');
                    this._videoCtx = this._videoCanvas.getContext('2d');
                    this._videoCanvas.width = video.videoWidth;
                    this._videoCanvas.height = video.videoHeight;
                }
                
                // Only redraw when needed
                if (!this._lastVideoTime || this._lastVideoTime !== video.currentTime) {
                    this._videoCtx.drawImage(video, 0, 0);
                    this._lastVideoTime = video.currentTime;
                }
                
                const x = Math.floor(uv.x * this._videoCanvas.width);
                const y = Math.floor(uv.y * this._videoCanvas.height);
                const pixel = this._videoCtx.getImageData(x, y, 1, 1).data;
                const brightness = (pixel[0] + pixel[1] + pixel[2]) / (255 * 3);
                return brightness * 0.1;
            }
            
            // For image textures - use caching for performance
            if (!this._imageCache) {
                this._imageCache = {};
            }
            
            const img = this.material.uniforms.tDiffuse.value.image;
            if (!img || !img.width) return 0;
            
            const cacheKey = img.src || 'default';
            
            if (!this._imageCache[cacheKey]) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(img, 0, 0);
                
                // Cache the image data for faster access
                this._imageCache[cacheKey] = {
                    canvas: tempCanvas,
                    ctx: tempCtx,
                    imageData: tempCtx.getImageData(0, 0, img.width, img.height)
                };
            }
            
            const cache = this._imageCache[cacheKey];
            const x = Math.floor(uv.x * cache.canvas.width);
            const y = Math.floor(uv.y * cache.canvas.height);
            const idx = (y * cache.canvas.width + x) * 4;
            const data = cache.imageData.data;
            const brightness = (data[idx] + data[idx+1] + data[idx+2]) / (255 * 3);
            return brightness * 0.1;
        } catch (e) {
            return 0;
        }
    }

    toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    startRecording() {
        const stream = this.renderer.domElement.captureStream(30); // 30 FPS
        this.recordedChunks = [];
        
        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'video/webm;codecs=vp9'
        });

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'osciline-recording.webm';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        this.mediaRecorder.start();
        this.isRecording = true;
        const recordButton = document.getElementById('recordVideo');
        recordButton.textContent = 'Stop Recording';
        recordButton.classList.add('recording');
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            this.isRecording = false;
            const recordButton = document.getElementById('recordVideo');
            recordButton.textContent = 'Record Video';
            recordButton.classList.remove('recording');
        }
    }

    calculateWaveAtPoint(uv, lineIndex) {
        let wave = 0;
        const linePhase = this.pseudoRandom(lineIndex) * 6.28318 * this.material.uniforms.desyncAmount.value;
        
        for (let i = 1; i <= this.material.uniforms.waveComplexity.value; i++) {
            const phase = this.time * (0.5 + this.pseudoRandom(i + lineIndex) * 0.5) + linePhase;
            const freq = this.material.uniforms.baseFrequency.value * 
                        (1.0 + this.pseudoRandom(i * lineIndex) * this.material.uniforms.desyncAmount.value);
            wave += Math.sin(uv.x * freq + phase) * (this.material.uniforms.baseAmplitude.value / i);
        }
        return wave;
    }

    calculateDisruptionAtPoint(uv) {
        try {
            const x = Math.floor(uv.x * this.exportCanvas.width);
            const y = Math.floor(uv.y * this.exportCanvas.height);
            const pixel = this.exportCtx.getImageData(x, y, 1, 1).data;
            const brightness = (pixel[0] + pixel[1] + pixel[2]) / (255 * 3);
            return brightness * 0.1;
        } catch (error) {
            console.warn('Failed to sample texture:', error);
            return 0;
        }
    }

    pseudoRandom(seed) {
        return Math.abs(Math.sin(seed * 78.233) * 43758.5453) % 1;
    }

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (file.type.startsWith('image/')) {
            this.loadImage(file);
        } else if (file.type.startsWith('video/')) {
            this.loadVideo(file);
        }
    }

    async processDetections(image) {
        if (!this.model || !image || !image.width || !image.height || 
            (image instanceof HTMLVideoElement && image.readyState !== 4)) {
            return;
        }
        
        try {
            const detections = await this.model.detect(image);
            const detectionData = new Float32Array(1024 * 4);
            
            detections.forEach((detection, i) => {
                const [x, y, width, height] = detection.bbox;
                detectionData[i * 4] = x / image.width;
                detectionData[i * 4 + 1] = y / image.height;
                detectionData[i * 4 + 2] = width / image.width;
                detectionData[i * 4 + 3] = height / height;
            });

            this.detectionTexture.image.data = detectionData;
            this.detectionTexture.needsUpdate = true;
            this.material.uniforms.numDetections.value = detections.length;
        } catch (error) {
            console.error('Detection processing error:', error);
        }
    }

    loadImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                if (img.width === 0 || img.height === 0) {
                    console.error('Invalid image dimensions');
                    return;
                }
                
                this.aspectRatio = img.width / img.height;
                this.handleResize();
                
                const texture = new THREE.TextureLoader().load(e.target.result);
                this.material.uniforms.tDiffuse.value = texture;
                this.processDetections(img);
            };
            img.onerror = (error) => {
                console.error('Image loading error:', error);
            };
            img.src = e.target.result;
        };
        reader.onerror = (error) => {
            console.error('File reading error:', error);
        };
        reader.readAsDataURL(file);
    }

    loadVideo(file) {
        const video = document.createElement('video');
        let detectionTimeout;
        
        video.onloadedmetadata = () => {
            if (video.videoWidth === 0 || video.videoHeight === 0) {
                console.error('Invalid video dimensions');
                return;
            }
            
            this.aspectRatio = video.videoWidth / video.videoHeight;
            this.handleResize();
            
            video.play();
            const texture = new THREE.VideoTexture(video);
            this.material.uniforms.tDiffuse.value = texture;
            
            // Process detections with better timing
            let isProcessing = false;
            const processInterval = setInterval(() => {
                if (!video.paused && video.readyState === 4 && !isProcessing) {
                    isProcessing = true;
                    
                    // Clear previous timeout if exists
                    if (detectionTimeout) clearTimeout(detectionTimeout);
                    
                    // Set timeout for next detection
                    detectionTimeout = setTimeout(() => {
                        this.processDetections(video).finally(() => {
                            isProcessing = false;
                        });
                    }, 250); // Reduced frequency of detections
                }
                
                // Cleanup on video removal or error
                if (!this.material.uniforms.tDiffuse.value || 
                    this.material.uniforms.tDiffuse.value !== texture ||
                    video.error) {
                    clearInterval(processInterval);
                    if (detectionTimeout) clearTimeout(detectionTimeout);
                }
            }, 500); // Increased interval
        };

        // Better error handling
        video.onerror = (error) => {
            console.error('Video loading error:', error);
            document.getElementById('status').textContent = 'Video loading error';
        };

        video.src = URL.createObjectURL(file);
        video.loop = true;
        video.muted = true;
    }

    handleResize() {
        const containerHeight = window.innerHeight * 0.9; // Use 90% of viewport height
        let width, height;

        if (this.aspectRatio >= 1) {
            // Wide or square media: fit to height
            height = containerHeight;
            width = height * this.aspectRatio;
        } else {
            // Tall media: fit to height
            height = containerHeight;
            width = height * this.aspectRatio;
        }
        
        this.renderer.domElement.style.width = 'auto';
        this.renderer.domElement.style.height = '90vh';
        this.renderer.domElement.style.aspectRatio = `${this.aspectRatio}`;
        
        this.renderer.setSize(width, height);
        this.material.uniforms.resolution.value.set(width, height);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.time += 0.016;
        this.material.uniforms.time.value = this.time;
        this.renderer.render(this.scene, this.camera);
    }

    setupDragAndDock() {
        const panel = document.getElementById('controlPanel');
        const header = panel.querySelector('.controls-header');
        const dockButton = document.getElementById('dockButton');
        const minimizeButton = document.getElementById('minimizeButton');
        
        let isDragging = false;
        let transform = { x: 0, y: 0 };
        let startPos = { x: 0, y: 0 };
        
        // Load saved position
        const savedPosition = localStorage.getItem('controlPanelPosition');
        const savedDocked = localStorage.getItem('controlPanelDocked');
        const savedMinimized = localStorage.getItem('controlPanelMinimized');
        
        if (savedPosition) {
            try {
                transform = JSON.parse(savedPosition);
                updatePanelPosition();
            } catch(e) {
                console.warn('Invalid saved position');
            }
        }
        
        if (savedDocked === 'true') {
            panel.classList.add('docked');
            dockButton.innerHTML = '📍';
            transform = { x: 0, y: 0 };
            updatePanelPosition();
        }
        
        if (savedMinimized === 'true') {
            panel.classList.add('minimized');
            minimizeButton.innerHTML = '□';
        }

        function updatePanelPosition() {
            // Ensure panel stays within viewport
            const rect = panel.getBoundingClientRect();
            const maxX = window.innerWidth - rect.width;
            const maxY = window.innerHeight - rect.height;
            
            transform.x = Math.min(Math.max(transform.x, 0), maxX);
            transform.y = Math.min(Math.max(transform.y, 0), maxY);
            
            panel.style.transform = `translate(${transform.x}px, ${transform.y}px)`;
        }

        function dragStart(e) {
            if (panel.classList.contains('docked') || e.button !== 0) return;
            
            isDragging = true;
            const rect = panel.getBoundingClientRect();
            
            startPos = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
            
            header.style.cursor = 'grabbing';
            e.preventDefault();
        }

        function drag(e) {
            if (!isDragging) return;
            
            transform.x = e.clientX - startPos.x;
            transform.y = e.clientY - startPos.y;
            
            requestAnimationFrame(updatePanelPosition);
        }

        function dragEnd() {
            if (!isDragging) return;
            
            isDragging = false;
            header.style.cursor = 'grab';
            
            localStorage.setItem('controlPanelPosition', JSON.stringify(transform));
        }

        // Event listeners with passive option for better performance
        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag, { passive: true });
        document.addEventListener('mouseup', dragEnd);
        window.addEventListener('resize', updatePanelPosition);

        dockButton.addEventListener('click', () => {
            panel.classList.toggle('docked');
            dockButton.innerHTML = panel.classList.contains('docked') ? '📍' : '📌';
            
            if (panel.classList.contains('docked')) {
                transform = { x: 0, y: 0 };
                updatePanelPosition();
                localStorage.removeItem('controlPanelPosition');
            }
            
            localStorage.setItem('controlPanelDocked', panel.classList.contains('docked'));
        });

        minimizeButton.addEventListener('click', () => {
            panel.classList.toggle('minimized');
            minimizeButton.innerHTML = panel.classList.contains('minimized') ? '□' : '_';
            localStorage.setItem('controlPanelMinimized', panel.classList.contains('minimized'));
        });
    }

    loadDefaultImage() {
        const defaultImagePath = './images/daddy.jpg';
        console.log('Loading default image from:', defaultImagePath);
        
        const img = new Image();
        img.crossOrigin = "anonymous";
        
        img.onload = () => {
            console.log('Default image loaded successfully');
            if (img.width === 0 || img.height === 0) {
                console.error('Invalid image dimensions');
                return;
            }
            
            // Set aspect ratio before creating texture
            this.aspectRatio = img.width / img.height;
            this.handleResize();
            
            const texture = new THREE.TextureLoader().load(
                defaultImagePath,
                (tex) => {
                    console.log('Texture created successfully');
                    this.material.uniforms.tDiffuse.value = tex;
                    this.processDetections(img);
                    this.handleResize(); // Ensure proper sizing after texture load
                },
                null,
                (err) => console.error('Error creating texture:', err)
            );
        };
        
        img.onerror = (error) => {
            console.error('Error loading default image:', error);
            console.error('Image path tried:', img.src);
            document.getElementById('status').textContent = 'Error loading default image';
        };
        
        img.src = defaultImagePath;
    }

    getVertexShader() {
        return `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
    }

    getFragmentShader() {
        return `
            #ifdef GL_ES
            precision highp float;
            #endif

            uniform sampler2D tDiffuse;
            uniform sampler2D tDetections;
            uniform float rows;
            uniform float weight;
            uniform float brightness;
            uniform float numDetections;
            uniform float time;
            uniform float baseAmplitude;
            uniform float baseFrequency;
            uniform float waveComplexity;
            uniform float desyncAmount;
            uniform vec2 resolution;
            uniform vec3 lineColor;
            uniform vec3 backgroundColor;
            varying vec2 vUv;

            // Improved random function with better distribution
            float random(float seed) {
                return fract(sin(dot(vec2(seed, seed * 1.123), vec2(12.9898, 78.233))) * 43758.5453);
            }

            float baseWave(vec2 uv, float lineIndex) {
                // More stable time stepping for high amplitudes
                float stabilizedTime = floor(time * (20.0 / (1.0 + baseAmplitude))) / 20.0;
                
                // Pre-calculate common values
                float wave = 0.0;
                float stabilityFactor = 1.0 / (1.0 + baseAmplitude * 0.5);
                float linePhase = random(lineIndex) * 6.28318 * desyncAmount * stabilityFactor;
                
                // Base frequency scaled by stability
                float baseFreq = baseFrequency * stabilityFactor;
                
                for(float i = 1.0; i <= waveComplexity; i++) {
                    // Reduce randomness at high amplitudes
                    float randomFactor = random(i + lineIndex) * mix(1.0, 0.3, baseAmplitude);
                    float phase = stabilizedTime * (0.5 + randomFactor * 0.5) + linePhase;
                    
                    // Stabilize frequency variation
                    float freq = baseFreq * (1.0 + random(i * lineIndex) * desyncAmount * stabilityFactor);
                    
                    // Progressive amplitude reduction for higher harmonics
                    float amp = baseAmplitude / (i + baseAmplitude * 0.5);
                    wave += sin(uv.x * freq + phase) * amp;
                }
                
                // Smooth the overall wave
                return wave * (1.0 - exp(-waveComplexity));
            }

            float getImageInfluence(vec2 uv) {
                vec4 color = texture2D(tDiffuse, uv);
                float brightness = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                return brightness * 0.1;
            }

            float getLineIntensity(float dist, float halfWeight) {
                // Hard line with no anti-aliasing
                return float(dist < halfWeight);
            }

            void main() {
                vec2 uv = vUv;
                float spacing = 1.0 / rows;
                vec4 finalColor = vec4(backgroundColor, 1.0);
                
                // Process from bottom to top
                for(float i = rows - 1.0; i >= 0.0; i--) {
                    float lineY = i * spacing;
                    float wave = baseWave(uv, i);
                    float disruption = getImageInfluence(vec2(uv.x, lineY));
                    float finalY = lineY + wave + disruption;
                    
                    float halfWeight = (weight / rows) * 0.15;
                    float dist = abs(uv.y - finalY);
                    
                    // Improved line rendering
                    float lineIntensity = 1.0 - smoothstep(0.0, halfWeight, dist);
                    lineIntensity = pow(lineIntensity, 1.2); // Sharpen edges slightly
                    
                    vec4 currentLineColor = vec4(lineColor.rgb, lineIntensity);
                    finalColor = mix(finalColor, currentLineColor, lineIntensity);
                }

                gl_FragColor = finalColor * brightness;
            }
        `;
    }
}

new OscilineEffect();
