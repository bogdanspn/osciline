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
    }

    async loadDetectionModel() {
        this.model = await cocoSsd.load();
        document.getElementById('status').textContent = 'Model loaded';
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
                baseAmplitude: { value: 0.0 },
                baseFrequency: { value: 0.0 },
                phaseOffset: { value: 0.0 },
                waveComplexity: { value: 0.0 },
                desyncAmount: { value: 0.0 },
                resolution: { value: new THREE.Vector2() }
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
        document.getElementById('baseAmplitude').addEventListener('input', (e) => {
            this.material.uniforms.baseAmplitude.value = parseFloat(e.target.value) / 1000;
        });

        document.getElementById('baseFrequency').addEventListener('input', (e) => {
            this.material.uniforms.baseFrequency.value = parseFloat(e.target.value) / 10;
        });

        document.getElementById('waveComplexity').addEventListener('input', (e) => {
            this.material.uniforms.waveComplexity.value = parseFloat(e.target.value);
        });

        document.getElementById('desyncAmount').addEventListener('input', (e) => {
            this.material.uniforms.desyncAmount.value = parseFloat(e.target.value) / 100;
        });
    }

    setupExport() {
        document.getElementById('exportSvg').addEventListener('click', () => this.exportSVG());
    }

    exportSVG() {
        const width = this.renderer.domElement.width;
        const height = this.renderer.domElement.height;
        const rows = this.material.uniforms.rows.value;
        const spacing = height / rows;
        const lineWeight = Math.max(1, this.material.uniforms.weight.value);
        
        try {
            // Create offscreen canvas for texture sampling
            this.exportCanvas = this.exportCanvas || document.createElement('canvas');
            this.exportCtx = this.exportCtx || this.exportCanvas.getContext('2d');
            
            // Setup texture sampling
            let textureImage = null;
            if (this.material.uniforms.tDiffuse.value) {
                if (this.material.uniforms.tDiffuse.value.isVideoTexture) {
                    textureImage = this.material.uniforms.tDiffuse.value.image;
                } else {
                    textureImage = this.material.uniforms.tDiffuse.value.image;
                }
                
                this.exportCanvas.width = textureImage.width || width;
                this.exportCanvas.height = textureImage.height || height;
                this.exportCtx.drawImage(textureImage, 0, 0);
            }

            // Create SVG document
            let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
                <style>path { stroke: #00ff33; stroke-width: ${lineWeight}px; fill: none; }</style>`;
            
            // Generate paths for each line
            for (let i = 0; i < rows; i++) {
                const y = i * spacing;
                let pathPoints = [];
                
                // Sample points across the width
                for (let x = 0; x < width; x += 2) {
                    const uv = { x: x / width, y: y / height };
                    const wave = this.calculateWaveAtPoint(uv, i);
                    const disruption = textureImage ? this.calculateDisruptionAtPoint(uv) : 0;
                    const finalY = y + wave * height + disruption * height;
                    pathPoints.push(`${x.toFixed(1)},${finalY.toFixed(1)}`);
                }
                
                // Create smooth path
                svg += `<path d="M ${pathPoints.join(' L ')}" />`;
            }
            
            svg += '</svg>';
            
            // Download SVG
            const blob = new Blob([svg], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = 'scanlines.svg';
            link.href = url;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            console.log('SVG export complete');
        } catch (error) {
            console.error('SVG export failed:', error);
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
        if (!this.model) return;
        
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
    }

    loadImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const texture = new THREE.TextureLoader().load(e.target.result);
                this.material.uniforms.tDiffuse.value = texture;
                this.processDetections(img);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    loadVideo(file) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.loop = true;
        video.muted = true;
        video.play();
        
        const texture = new THREE.VideoTexture(video);
        this.material.uniforms.tDiffuse.value = texture;
        
        // Process detections every few frames
        setInterval(() => this.processDetections(video), 100);
    }

    handleResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
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
            varying vec2 vUv;

            // Improved random function with better distribution
            float random(float seed) {
                return fract(sin(dot(vec2(seed, seed * 1.123), vec2(12.9898, 78.233))) * 43758.5453);
            }

            float baseWave(vec2 uv, float lineIndex) {
                // Stabilize wave calculation by rounding time
                float stabilizedTime = floor(time * 30.0) / 30.0;
                float wave = 0.0;
                float linePhase = random(lineIndex) * 6.28318 * desyncAmount;
                
                for(float i = 1.0; i <= waveComplexity; i++) {
                    float phase = stabilizedTime * (0.5 + random(i + lineIndex) * 0.5) + linePhase;
                    float freq = baseFrequency * (1.0 + random(i * lineIndex) * desyncAmount);
                    wave += sin(uv.x * freq + phase) * (baseAmplitude / i);
                }
                return wave;
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
                float lineY = 0.0;
                vec4 finalColor = vec4(0.0);
                
                for(float i = 0.0; i < rows; i++) {
                    lineY = i * spacing;
                    
                    float wave = baseWave(uv, i);
                    float disruption = getImageInfluence(vec2(uv.x, lineY));
                    float finalY = lineY + wave + disruption;
                    
                    // Simplified line rendering with hard edges
                    float halfWeight = (weight / rows) * 0.15;
                    float dist = abs(uv.y - finalY);
                    float line = float(dist < halfWeight);
                    
                    vec4 lineColor = vec4(0.0, 1.0, 0.2, 1.0);
                    finalColor = max(finalColor, line * lineColor);
                }

                gl_FragColor = finalColor * brightness;
            }
        `;
    }
}

new OscilineEffect();
