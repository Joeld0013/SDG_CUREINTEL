class HealthGuardChat {
    constructor() {
        this.API_BASE_URL = "http://localhost:5000";

        // --- DOM Elements ---
        this.conversationArea = document.getElementById('conversationArea');
        this.textInput = document.getElementById('textInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.fileInput = document.getElementById('fileInput');
        this.fileUploadBtn = document.getElementById('fileUploadBtn');
        this.voiceBtn = document.getElementById('voiceBtn');
        this.scanBtn = document.querySelector('#scanBtn');
        this.clearBtn = document.querySelector('#clearBtn');
        this.inputSection = document.getElementById('inputSection');
        this.inputContainer = document.getElementById('inputContainer');
        this.actionButtons = document.getElementById('actionButtons');
        this.placeholderText = document.getElementById('placeholderText');

        // --- Toggle Elements ---
        this.modeToggle = document.getElementById('modeToggle');

        // --- Image Preview Elements ---
        this.imagePreviewWrapper = document.getElementById('imagePreviewWrapper');
        this.previewThumbnail = document.getElementById('previewThumbnail');
        this.removeImageBtn = document.getElementById('removeImageBtn');

        // --- State ---
        this.attachedImage = null;
        this.isRecognizing = false;
        this.recognition = null;
        this.currentScanMessageId = null;
        this.doctorMode = false; // New state for doctor mode

        this.initializeEventListeners();
        this.adjustTextareaHeight();
        this.initializeSpeechRecognition();
        this.initializeBackgroundMessageListener();
        this.updatePlaceholderText();
    }

    initializeEventListeners() {
        this.sendBtn.addEventListener('click', () => this.handleSendMessage());
        this.textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });
        this.textInput.addEventListener('input', () => {
            this.adjustTextareaHeight();
            this.sendBtn.disabled = this.textInput.value.trim().length === 0 && !this.attachedImage;
        });

        // --- Image Handling Events ---
        this.fileUploadBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        this.removeImageBtn.addEventListener('click', () => this.handleRemoveImage());

        // --- Other Button Events ---
        this.voiceBtn.addEventListener('click', () => this.handleVoiceInput());
        if (this.scanBtn) this.scanBtn.addEventListener('click', () => this.handlePageScan());
        if (this.clearBtn) this.clearBtn.addEventListener('click', () => this.clearConversation());

        // --- Toggle Event ---
        this.modeToggle.addEventListener('click', () => this.toggleDoctorMode());
    }

    // Toggle between normal and doctor mode
    toggleDoctorMode() {
        this.doctorMode = !this.doctorMode;
        
        // Update toggle appearance
        this.modeToggle.classList.toggle('active', this.doctorMode);
        
        // Update UI elements
        this.updateUIForMode();
        this.updatePlaceholderText();
        
        console.log(`Doctor mode: ${this.doctorMode ? 'ON' : 'OFF'}`);
    }

    // Update UI elements based on current mode
    updateUIForMode() {
        const elements = [
            this.inputSection,
            this.inputContainer,
            this.textInput,
            this.sendBtn,
            this.voiceBtn,
            ...this.actionButtons.children
        ];

        elements.forEach(element => {
            if (element) {
                element.classList.toggle('doctor-mode', this.doctorMode);
            }
        });

        this.conversationArea.classList.toggle('doctor-mode', this.doctorMode);
        
        // Update placeholder text
        if (this.doctorMode) {
            this.textInput.placeholder = "Ask me any health question - symptoms, treatments, conditions...";
        } else {
            this.textInput.placeholder = "Ask about health information...";
        }
    }

    // Update placeholder text based on mode
    updatePlaceholderText() {
        if (this.placeholderText) {
            this.placeholderText.classList.toggle('doctor-mode', this.doctorMode);
            
            if (this.doctorMode) {
                this.placeholderText.innerHTML = `
                    <h2>🩺 Doctor Mode Active</h2>
                    <p>Ask me anything about health, symptoms, treatments, or medical conditions</p>
                `;
            } else {
                this.placeholderText.innerHTML = `
                    <h2>Hi, There!</h2>
                    <p>Welcome to HealthGuard AI</p>
                `;
            }
        }
    }

    // Listen for messages from background script
    initializeBackgroundMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            console.log('[panel.js] Received message:', request.action);
            
            switch (request.action) {
                case "analysisStarted":
                    this.updateScanMessage("🔍 Analyzing health claims...");
                    break;
                    
                case "scanResults":
                    this.displayScanResults(request.data);
                    break;
                    
                case "scanComplete":
                    if (request.success) {
                        this.updateScanMessage("✅ " + request.message);
                    } else {
                        this.updateScanMessage("⚠️ " + request.message);
                    }
                    this.currentScanMessageId = null;
                    break;
                    
                case "scanError":
                    this.updateScanMessage("❌ " + request.message);
                    this.currentScanMessageId = null;
                    break;
            }
            
            return true;
        });
    }

    // --- Image Handling Methods ---
    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file || !file.type.startsWith('image/')) {
            if (file) this.addMessage('⚠️ Please select a valid image file.', 'bot');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.attachedImage = e.target.result;
            this.previewThumbnail.src = this.attachedImage;
            this.imagePreviewWrapper.style.display = 'block';
            this.sendBtn.disabled = false;
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    }
    
    handleRemoveImage() {
        this.attachedImage = null;
        this.imagePreviewWrapper.style.display = 'none';
        this.previewThumbnail.src = '';
        this.fileInput.value = '';
        if (this.textInput.value.trim().length === 0) {
            this.sendBtn.disabled = true;
        }
    }

    async handleSendMessage() {
        if (this.isRecognizing) this.recognition.stop();

        const text = this.textInput.value.trim();
        const image = this.attachedImage;

        if (!text && !image) return;

        this.addMessage(text, 'user', image);
        
        this.textInput.value = '';
        this.handleRemoveImage();
        this.adjustTextareaHeight();
        this.sendBtn.disabled = true;

        this.addLoadingMessage();

        try {
            const inputType = image ? 'image_text' : (this.isURL(text) ? 'link' : 'text');
            const contentPayload = image ? { text: text, image_base64: image } : text;
            
            // Choose endpoint based on mode
            let endpoint;
            if (this.doctorMode) {
                endpoint = '/doctor-mode';
            } else {
                // Check if input contains multiple health claims
                endpoint = this.containsMultipleClaims(text) ? '/analyze-multiple' : '/validate';
            }
            
            const response = await fetch(`${this.API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ type: inputType, content: contentPayload })
            });

            if (!response.ok) throw new Error(`Server error: ${response.status}`);
            
            const data = await response.json();
            
            this.removeLoadingMessage();
            
            if (this.doctorMode) {
                this.displayDoctorResponse(data);
            } else {
                if (data.is_health_related === false) {
                    this.addMessage(data.message || "This doesn't appear to be a health-related query.", 'bot');
                } else {
                    // Check if it's multiple claims analysis or single validation
                    if (data.claims && Array.isArray(data.claims)) {
                        this.displayMultipleClaimsResult(data);
                    } else {
                        this.displayValidationResult(data);
                    }
                }
            }

        } catch (error) {
            this.removeLoadingMessage();
            const errorMsg = error.message.includes('fetch') 
              ? "❌ Cannot connect to backend. Please ensure the server is running."
              : `❌ Error: ${error.message}`;
            this.addMessage(errorMsg, 'bot');
        }
    }

    // Add this new method to detect multiple claims:
    containsMultipleClaims(text) {
        // Simple heuristic: if text contains multiple sentences with health keywords
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
        if (sentences.length < 2) return false;
        
        const healthKeywords = [
            'vitamin', 'medicine', 'treatment', 'cure', 'prevent', 'disease', 'health', 
            'exercise', 'diet', 'nutrition', 'symptom', 'doctor', 'medical', 'therapy',
            'supplement', 'drug', 'medication', 'illness', 'condition', 'risk', 'benefit'
        ];
        
        let healthSentences = 0;
        sentences.forEach(sentence => {
            const lowerSentence = sentence.toLowerCase();
            if (healthKeywords.some(keyword => lowerSentence.includes(keyword))) {
                healthSentences++;
            }
        });
        
        return healthSentences >= 2;
    }

    // FIXED: Display multiple claims results with proper sources
    displayMultipleClaimsResult(data) {
        const { total_claims, accurate_count, misleading_count, unverifiable_count, overall_accuracy_percentage } = data;
        const claims = data.claims || [];
        const sources = data.sources || []; // Make sure we get sources
        
        // Create overall statistics display
        const statsHTML = `
            <div class="multiple-claims-header">
                <h4>📊 Health Claims Analysis</h4>
                <div class="overall-stats">
                    <div class="stat-card accurate">
                        <span class="stat-number">${accurate_count}</span>
                        <span class="stat-label">Accurate</span>
                    </div>
                    <div class="stat-card misleading">
                        <span class="stat-number">${misleading_count}</span>
                        <span class="stat-label">Misleading</span>
                    </div>
                    <div class="stat-card unverifiable">
                        <span class="stat-number">${unverifiable_count}</span>
                        <span class="stat-label">Unverifiable</span>
                    </div>
                </div>
                <div class="accuracy-summary">
                    <strong>Overall Accuracy: ${overall_accuracy_percentage}%</strong> 
                    (${accurate_count}/${total_claims} claims are accurate)
                </div>
            </div>
        `;
        
        // Create individual claims display
        const claimsHTML = claims.map((claim, index) => {
            let classificationIcon, classificationClass;
            switch (claim.classification) {
                case 'Accurate': 
                    classificationIcon = '✅'; 
                    classificationClass = 'accurate'; 
                    break;
                case 'Misleading': 
                    classificationIcon = '❌'; 
                    classificationClass = 'misleading'; 
                    break;
                default: 
                    classificationIcon = '❔'; 
                    classificationClass = 'unverifiable'; 
                    break;
            }
            
            return `
                <div class="individual-claim ${classificationClass}">
                    <div class="claim-header">
                        <span class="claim-number">Claim ${index + 1}</span>
                        <span class="claim-classification">
                            ${classificationIcon} ${claim.classification}
                            <span class="confidence">${claim.confidence_score}% confidence</span>
                        </span>
                    </div>
                    <div class="claim-text">"${claim.claim_text}"</div>
                    <div class="claim-explanation">
                        <strong>Analysis:</strong> ${claim.explanation}
                    </div>
                    ${claim.correct_information ? `
                        <div class="correct-info">
                            <strong>Correct Information:</strong> ${claim.correct_information}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        // FIXED: Sources section - ensure we display the sources properly
        const sourcesHTML = sources && sources.length > 0 ? `
            <div class="sources-section">
                <h5>📚 Verified Medical Sources</h5>
                <div class="sources-grid">
                    ${sources.map(source => `
                        <div class="source-item">
                            <div class="source-details">
                                <span class="source-name">${source.name}</span>
                                <a href="${source.url}" target="_blank" rel="noopener noreferrer" class="source-link">
                                    <i class="fa-solid fa-external-link-alt"></i> Visit Source
                                </a>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : `
            <div class="sources-section">
                <h5>📚 Verified Medical Sources</h5>
                <p>No specific sources were provided, but information is based on verified medical databases.</p>
            </div>
        `;
        
        const summaryHTML = data.summary ? `
            <div class="analysis-summary">
                <h5>📋 Summary</h5>
                <p>${data.summary}</p>
            </div>
        ` : '';
        
        const botMessageHTML = `
            <div class="message-avatar"> 
                <img src="HealthGuardAI.png" alt="Bot" class="logo-image"> 
            </div>
            <div class="message-content">
                <div class="multiple-claims-analysis">
                    ${statsHTML}
                    <div class="claims-breakdown">
                        <h5>🔍 Individual Claims Analysis</h5>
                        ${claimsHTML}
                    </div>
                    ${sourcesHTML}
                    ${summaryHTML}
                </div>
            </div>
        `;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot multiple-claims';
        messageDiv.innerHTML = botMessageHTML;
        this.conversationArea.appendChild(messageDiv);
        this.scrollToBottom();
    }
        
    handlePageScan() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                const currentTabId = tabs[0].id;
                
                this.currentScanMessageId = this.addScanMessage("🔎 Scanning current page for health claims...");
                
                chrome.runtime.sendMessage({
                    action: "scanPage",
                    tabId: currentTabId
                });
                
                console.log('[panel.js] Scan initiated, keeping panel open');
            } else {
                this.addMessage("❌ Could not find an active tab to scan.", "bot");
            }
        });
    }

    // Add a special scan message that can be updated
    addScanMessage(content) {
        document.querySelector('.placeholder-text')?.remove();
        
        const messageId = 'scan-message-' + Date.now();
        const messageDiv = document.createElement('div');
        messageDiv.id = messageId;
        messageDiv.className = 'message bot';
        
        messageDiv.innerHTML = `
            <div class="message-avatar"><img src="HealthGuardAI.png" alt="Bot" class="logo-image"></div>
            <div class="message-content">
                <div class="scan-status">${content}</div>
            </div>
        `;
        
        this.conversationArea.appendChild(messageDiv);
        this.scrollToBottom();
        
        return messageId;
    }

    // Update the scanning message
    updateScanMessage(content) {
        if (this.currentScanMessageId) {
            const messageDiv = document.getElementById(this.currentScanMessageId);
            if (messageDiv) {
                const statusDiv = messageDiv.querySelector('.scan-status');
                if (statusDiv) {
                    statusDiv.innerHTML = content;
                }
            }
        }
    }

    // FIXED: Display scan results with proper sources
    displayScanResults(data) {
        if (!this.currentScanMessageId) return;
        
        const messageDiv = document.getElementById(this.currentScanMessageId);
        if (!messageDiv) return;
        
        const stats = data.statistics;
        const claims = data.claims || [];
        const sources = data.sources || []; // Make sure we get sources
        
        const progressBarHTML = this.createProgressBar(stats);
        
        // FIXED: Include sources in scan results
        const sourcesSection = sources && sources.length > 0 ? `
            <div class="scan-sources">
                <h6>📚 Verified Sources Used:</h6>
                <div class="scan-sources-list">
                    ${sources.map(source => `
                        <a href="${source.url}" target="_blank" rel="noopener noreferrer" class="scan-source-link">
                            ${source.name} <i class="fa-solid fa-external-link-alt"></i>
                        </a>
                    `).join('')}
                </div>
            </div>
        ` : '';
        
        const contentDiv = messageDiv.querySelector('.message-content');
        contentDiv.innerHTML = `
            <div class="scan-results-header">
                <h4>📊 Page Analysis Complete</h4>
                <p>Found <strong>${stats.total_claims}</strong> health-related claims</p>
            </div>
            ${progressBarHTML}
            <div class="scan-summary">
                <div class="summary-stats">
                    <span class="stat-item accurate">✅ ${stats.accurate_count} Accurate (${stats.accurate_percentage}%)</span>
                    <span class="stat-item misleading">❌ ${stats.misleading_count} Misleading (${stats.misleading_percentage}%)</span>
                    <span class="stat-item unverifiable">❔ ${stats.unverifiable_count} Unverifiable (${stats.unverifiable_percentage}%)</span>
                </div>
            </div>
            ${sourcesSection}
        `;
        
        this.scrollToBottom();
    }

    // Create progress bar HTML
    createProgressBar(stats) {
        const { accurate_percentage, misleading_percentage, unverifiable_percentage } = stats;
        
        return `
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-segment accurate" 
                         style="width: ${accurate_percentage}%"
                         title="Accurate: ${accurate_percentage}%"></div>
                    <div class="progress-segment unverifiable" 
                         style="width: ${unverifiable_percentage}%"
                         title="Unverifiable: ${unverifiable_percentage}%"></div>
                    <div class="progress-segment misleading" 
                         style="width: ${misleading_percentage}%"
                         title="Misleading: ${misleading_percentage}%"></div>
                </div>
            </div>
        `;
    }

    // FIXED: Display doctor mode response with proper sources
    displayDoctorResponse(data) {
        if (data.is_health_related === false) {
            this.addMessage(data.message || "I am HealthGuard AI Doctor and can only assist with health and medical questions.", 'bot', null, true);
            return;
        }

        const verifiedSources = data.verified_sources || []; // Make sure we get verified sources

        const botMessageHTML = `
            <div class="message-avatar"> <img src="HealthGuardAI.png" alt="Bot" class="logo-image"> </div>
            <div class="message-content">
                <div class="doctor-response">
                    <div class="doctor-response-header">
                        <i class="fa-solid fa-stethoscope"></i>
                        <h4>Medical Consultation</h4>
                    </div>
                    
                    ${data.condition_overview ? `
                        <div class="condition-overview">
                            <strong>Overview:</strong> ${data.condition_overview}
                        </div>
                    ` : ''}
                    
                    <div class="doctor-section">
                        <p><strong>Detailed Information:</strong></p>
                        <p>${data.detailed_explanation || 'No detailed explanation available.'}</p>
                    </div>
                    
                    ${data.symptoms && data.symptoms.length > 0 ? `
                        <div class="doctor-section">
                            <h5><i class="fa-solid fa-thermometer"></i> Common Symptoms</h5>
                            <ul>
                                ${data.symptoms.map(symptom => `<li>${symptom}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                    
                    ${data.causes && data.causes.length > 0 ? `
                        <div class="doctor-section">
                            <h5><i class="fa-solid fa-search"></i> Common Causes</h5>
                            <ul>
                                ${data.causes.map(cause => `<li>${cause}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                    
                    ${data.treatments && data.treatments.length > 0 ? `
                        <div class="doctor-section">
                            <h5><i class="fa-solid fa-pills"></i> Treatment Options</h5>
                            <ul>
                                ${data.treatments.map(treatment => `<li>${treatment}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                    
                    ${data.prevention ? `
                        <div class="doctor-section">
                            <h5><i class="fa-solid fa-shield"></i> Prevention</h5>
                            <p>${data.prevention}</p>
                        </div>
                    ` : ''}
                    
                    ${data.when_to_seek_help ? `
                        <div class="doctor-section">
                            <h5><i class="fa-solid fa-hospital"></i> When to Seek Medical Help</h5>
                            <p>${data.when_to_seek_help}</p>
                        </div>
                    ` : ''}
                    
                    ${data.important_notes ? `
                        <div class="important-notes">
                            <h5><i class="fa-solid fa-exclamation-triangle"></i> Important Notes</h5>
                            <p>${data.important_notes}</p>
                        </div>
                    ` : ''}
                    
                    ${verifiedSources && verifiedSources.length > 0 ? `
                        <div class="verified-sources">
                            <h5><i class="fa-solid fa-certificate"></i> Verified Medical Sources</h5>
                            <div class="doctor-sources-grid">
                                ${verifiedSources.map(source => `
                                    <div class="doctor-source-item">
                                        <div class="source-header">
                                            <span class="source-name">${source.name}</span>
                                            <span class="source-category ${source.category?.toLowerCase()}">${source.category || 'Medical'}</span>
                                        </div>
                                        <div class="source-details">
                                            <p class="source-credibility">${source.credibility || 'Trusted medical source'}</p>
                                            <a href="${source.url}" target="_blank" rel="noopener noreferrer" class="source-link">
                                                <i class="fa-solid fa-external-link-alt"></i> Visit Source
                                            </a>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>`;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot doctor-mode';
        messageDiv.innerHTML = botMessageHTML;
        this.conversationArea.appendChild(messageDiv);
        this.scrollToBottom();
    }

    // --- UI Update Methods ---
    addMessage(content, type = 'user', imageUrl = null, isDoctorMode = false) {
        document.querySelector('.placeholder-text')?.remove();
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}${isDoctorMode && type === 'bot' ? ' doctor-mode' : ''}`;
        
        const avatarSrc = type === 'user' ? null : 'HealthGuardAI.png';
        const avatarContent = type === 'user' ? '<i class="fa-solid fa-user"></i>' : `<img src="${avatarSrc}" alt="Bot" class="logo-image">`;
        const imageHTML = imageUrl ? `<div class="message-image-container"><img src="${imageUrl}" alt="User upload" class="message-image"></div>` : '';
        const contentHTML = content ? `<div class="message-text">${content.replace(/\n/g, '<br>')}</div>` : '';
        
        messageDiv.innerHTML = `
            <div class="message-avatar">${avatarContent}</div>
            <div class="message-content">
                ${imageHTML}
                ${contentHTML}
            </div>
        `;
        this.conversationArea.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addLoadingMessage() {
        document.querySelector('.placeholder-text')?.remove();
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'loadingMessage';
        loadingDiv.className = `message bot${this.doctorMode ? ' doctor-mode' : ''}`;
        
        const loadingText = this.doctorMode ? 'Consulting medical databases...' : 'Analyzing...';
        
        loadingDiv.innerHTML = `
            <div class="message-avatar"> <img src="HealthGuardAI.png" alt="Bot" class="logo-image"> </div>
            <div class="message-content loading${this.doctorMode ? ' doctor-mode' : ''}">
                <div class="loading-spinner"></div>
                <span>${loadingText}</span>
            </div>
        `;
        this.conversationArea.appendChild(loadingDiv);
        this.scrollToBottom();
    }
    
    removeLoadingMessage() {
        document.getElementById('loadingMessage')?.remove();
    }

    // FIXED: Display validation result with proper sources
    displayValidationResult(data) {
        let classificationIcon, classificationClass;
        switch (data.classification) {
            case 'Accurate': classificationIcon = '✅'; classificationClass = 'accurate'; break;
            case 'Misleading': classificationIcon = '❌'; classificationClass = 'misleading'; break;
            default: classificationIcon = '❔'; classificationClass = 'unverifiable'; break;
        }

        // FIXED: Ensure sources are properly handled
        const sources = data.sources || [];
        const sourcesTableRows = sources && sources.length > 0
            ? sources.map(s => `
                <tr>
                    <td>${s.name}</td>
                    <td>
                        <a href="${s.url}" target="_blank" rel="noopener noreferrer" class="source-table-link">
                            <i class="fa-solid fa-external-link-alt"></i> View Source
                        </a>
                    </td>
                </tr>
            `).join('')
            : '<tr><td colspan="2">No specific sources were cited for this validation.</td></tr>';

        const botMessageHTML = `
            <div class="message-avatar"> <img src="HealthGuardAI.png" alt="Bot" class="logo-image"> </div>
            <div class="message-content">
                <div class="validation-header ${classificationClass}">
                    <span class="classification-icon">${classificationIcon}</span>
                    <span class="classification-text">${data.classification || 'N/A'}</span>
                    <span class="confidence-score">${data.confidence_score || 0}% confidence</span>
                </div>
                <p class="summary-text">${data.summary || 'No summary available.'}</p>
                <div class="details-section">
                    <h4>Explanation</h4><p>${data.explanation || 'N/A'}</p>
                    <h4>The Correct Information</h4><p>${data.correct_information || 'N/A'}</p>
                    <h4>Verified Medical Sources</h4>
                    <table class="sources-table">
                        <thead><tr><th>Medical Organization</th><th>Official Link</th></tr></thead>
                        <tbody>${sourcesTableRows}</tbody>
                    </table>
                </div>
            </div>`;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot';
        messageDiv.innerHTML = botMessageHTML;
        this.conversationArea.appendChild(messageDiv);
        this.scrollToBottom();
    }

    clearConversation() {
        this.updatePlaceholderText();
        this.conversationArea.innerHTML = '';
        this.conversationArea.appendChild(this.placeholderText);
        this.textInput.value = '';
        this.handleRemoveImage();
        this.adjustTextareaHeight();
        this.currentScanMessageId = null;
    }

    // --- Helper Methods ---
    adjustTextareaHeight() {
        this.textInput.style.height = 'auto';
        this.textInput.style.height = `${Math.min(this.textInput.scrollHeight, 100)}px`;
    }

    scrollToBottom() {
        this.conversationArea.scrollTop = this.conversationArea.scrollHeight;
    }

    isURL = (s) => { try { new URL(s); return true; } catch (_) { return false; } };

    // --- Speech Recognition ---
    initializeSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.voiceBtn.disabled = true;
            this.voiceBtn.title = "Voice recognition not supported";
            return;
        }
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;

        this.recognition.onstart = () => {
            this.isRecognizing = true;
            this.voiceBtn.classList.add('is-listening');
            this.voiceBtn.title = "Stop listening";
        };
        this.recognition.onend = () => {
            this.isRecognizing = false;
            this.voiceBtn.classList.remove('is-listening');
            this.voiceBtn.title = "Voice input";
        };
        this.recognition.onerror = (event) => this.addMessage(`🎤 Speech error: ${event.error}`, 'bot');
        this.recognition.onresult = (event) => {
            let interim_transcript = '';
            let final_transcript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    final_transcript += event.results[i][0].transcript;
                } else {
                    interim_transcript += event.results[i][0].transcript;
                }
            }
            this.textInput.value = final_transcript + interim_transcript;
            this.textInput.dispatchEvent(new Event('input'));
        };
    }

    handleVoiceInput() {
        if (!this.recognition) return;
        if (this.isRecognizing) this.recognition.stop();
        else {
            this.textInput.value = '';
            this.recognition.start();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => { new HealthGuardChat(); });