const API_URL = 'https://pink-pants-backend-production.up.railway.app';
console.log('API_URL:', API_URL);

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('scriptForm');
    const editor = document.getElementById('editor');
    const commentsContainer = document.getElementById('comments-container');
    const fileInput = document.getElementById('scriptFile');
    const settingsButton = document.querySelector('.settings-button');
    const settingsPanel = document.querySelector('.settings-panel');
    const settingsOverlay = document.querySelector('.settings-overlay');
    const closeSettings = document.querySelector('.close-settings');
    const toggleSwitch = document.querySelector('#showRemoved');

    // Debug check
    if (!fileInput) {
        console.error('File input element not found!');
        return;
    }

    // Add at the top of the file with other state variables
    let showRemovedComments = false;  // Default to showing removed comments

    // Add settings overlay to the DOM if it doesn't exist
    if (!document.querySelector('.settings-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'settings-overlay';
        document.body.appendChild(overlay);
    }

    // Add this near the top of the file with other imports/constants
    const marked = window.marked; // If using CDN
    // Configure marked options if needed
    marked.setOptions({
        breaks: true, // Adds <br> on single line breaks
        gfm: true,    // GitHub Flavored Markdown
        sanitize: true // Sanitize HTML input
    });

    // Handle file upload
    fileInput.addEventListener('change', async function(e) {
        console.log('Starting file upload...');
        const file = e.target.files[0];
        if (file) {
            console.log('File selected:', file.name);
            
            if (file.name.endsWith('.docx')) {
                console.log('DOCX file detected');
                editor.innerText = "Loading document...";
                
                // Create FormData and send to server
                const formData = new FormData();
                formData.append('file', file);
                
                try {
                    const fullUrl = `${API_URL}/analyze`;
                    console.log('Sending request to:', fullUrl);  // Add this log
                    
                    const response = await fetch(fullUrl, {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    
                    const data = await response.json();
                    console.log('Server response:', data);
                    
                    if (data.script) {
                        // Preserve whitespace and line breaks
                        editor.style.whiteSpace = 'pre-wrap';
                        editor.innerText = data.script;
                        // Store the original script
                        editor.dataset.originalScript = data.script;
                    } else {
                        editor.innerText = "Error: No content received from server";
                    }
                } catch (error) {
                    console.error('Error:', error);
                    editor.innerText = "Error loading document: " + error.message;
                }
            } else {
                // Handle text files directly
                const reader = new FileReader();
                reader.onload = function(e) {
                    editor.style.whiteSpace = 'pre-wrap';
                    editor.innerText = e.target.result;
                    editor.dataset.originalScript = e.target.result;
                };
                reader.readAsText(file);
            }
        }
    });

    // Handle form submission
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        console.log('Form submitted');
        
        // Get case type from stored case settings
        const caseSettings = JSON.parse(localStorage.getItem('caseSettings') || '{}');
        const caseType = caseSettings.caseType || 'criminal'; // Default to criminal if not set
        
        // Create loading overlay
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'loading-overlay';
        loadingOverlay.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <div class="loading-status">Initializing analysis...</div>
            </div>
        `;
        document.body.appendChild(loadingOverlay);
        
        const updateLoadingStatus = async (status) => {
            const statusElement = loadingOverlay.querySelector('.loading-status');
            if (statusElement) {
                statusElement.textContent = status;
                console.log('Loading status updated:', status);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        };
        
        const scriptContent = editor.dataset.originalScript || editor.innerText;
        
        try {
            // Step 1: Label Script
            await updateLoadingStatus('Reading your script...');
            const labelResponse = await fetch(`${API_URL}/label-script`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    script: scriptContent,
                    case_type: caseType,  // Use case type from settings
                    side: document.getElementById('side').value,
                    exam_type: document.getElementById('examinationType').value,
                    witness_type: document.getElementById('witnessType').value,
                    witness: document.getElementById('witnessName').value
                })
            });
            
            if (!labelResponse.ok) throw new Error('Failed to label script');
            const labelData = await labelResponse.json();
            
            // Step 2: Identify Objections
            await updateLoadingStatus('Identifying potential objections...');
            const objectionResponse = await fetch(`${API_URL}/identify-objections`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    script: scriptContent,
                    labeled_script: labelData.labeled_script,
                    side: document.getElementById('side').value,
                    exam_type: document.getElementById('examinationType').value,
                    witness_type: document.getElementById('witnessType').value,
                    witness: document.getElementById('witnessName').value
                })
            });
            
            if (!objectionResponse.ok) throw new Error('Failed to identify objections');
            const objectionData = await objectionResponse.json();
            
            // Display initial results immediately
            editor.dataset.labeledScript = labelData.labeled_script;
            let currentObjections = objectionData.objections;
            displayResults({
                labeled_script: labelData.labeled_script,
                objections: currentObjections
            });

            // Step 3: If witness is an expert, analyze expert testimony first
            const witnessType = document.getElementById('witnessType').value;
            if (witnessType === 'expert witness') {
                await updateLoadingStatus('Analyzing expert testimony...');
                const expertField = document.getElementById('expertField').value;
                if (!expertField) {
                    throw new Error('Expert field is required');
                }
                
                const expertResponse = await fetch(`${API_URL}/analyze-expert`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        script: scriptContent,
                        labeled_script: labelData.labeled_script,
                        field: expertField
                    })
                });

                if (!expertResponse.ok) throw new Error('Failed to analyze expert testimony');
                const expertData = await expertResponse.json();
                console.log("Expert analysis response:", expertData);

                // Create new objections for expert conclusions
                expertData.forEach(analysis => {
                    // Handle both single sentence and array of sentences
                    const sentences = Array.isArray(analysis.conclusion) ? 
                        analysis.conclusion : [analysis.conclusion];
                        
                    sentences.forEach(sentenceNum => {
                        currentObjections.push({
                            id: `expert-${sentenceNum}`,
                            sentence: sentenceNum.toString(),
                            type: analysis.admissible ? 'Admissible Expert Opinion' : 'Improper Expert Opinion',
                            explanation: analysis.explanation,
                            riskLevel: analysis.admissible ? 'Low' : 'High'
                        });
                    });
                });

                // Update display with expert analysis
                displayResults({
                    labeled_script: labelData.labeled_script,
                    objections: currentObjections
                });
            }

            // Step 4: Verify objections
            await updateLoadingStatus('Verifying objections...');
            const verificationResponse = await fetch(`${API_URL}/verify-objections`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    objections: currentObjections.map(obj => ({
                        id: obj.id,
                        type: obj.type,
                        sentence: obj.sentence,
                        explanation: obj.explanation
                    })),
                    script: scriptContent,
                })
            });

            if (!verificationResponse.ok) throw new Error('Failed to verify objections');
            const verificationData = await verificationResponse.json();

            // Update objections with verification results
            currentObjections = currentObjections.map(obj => {
                // Find matching verification in the list
                const verification = verificationData.objections.find(v => v.id === obj.id);
                console.log(`Objection ${obj.id} verification:`, verification);
                
                if (verification) {
                    return {
                        ...obj,
                        riskLevel: verification.risk_level,
                        riskExplanation: verification.explanation
                    };
                }
                return obj;
            });

            // Update display with verified objections
            displayResults({
                labeled_script: labelData.labeled_script,
                objections: currentObjections
            });

            // Step 5: Analyze Hearsay (if any)
            const hearsayObjections = currentObjections.filter(
                obj => obj.type.toLowerCase() === 'hearsay'
            );
            
            if (hearsayObjections.length > 0) {
                await updateLoadingStatus('Analyzing hearsay objections...');
                console.log("Hearsay objections to analyze:", hearsayObjections);
                
                const caseSettings = JSON.parse(localStorage.getItem('caseSettings') || '{}');
                
                const hearsayResponse = await fetch(`${API_URL}/analyze-hearsay`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        hearsay_sentences: hearsayObjections,
                        case_type: caseType,
                        labeled_script: labelData.labeled_script,
                        defendant: caseSettings.defendant,
                        side: document.getElementById('side').value,
                        p_party_rep: caseSettings.p_party_representative || ''
                    })
                });
                
                if (!hearsayResponse.ok) throw new Error('Failed to analyze hearsay');
                const hearsayData = await hearsayResponse.json();
                console.log("Hearsay analysis response:", hearsayData);
                
                // Update objections with hearsay analysis
                currentObjections = currentObjections.map(obj => {
                    const hearsayAnalysis = hearsayData.find(h => h.id === obj.id);
                    if (hearsayAnalysis) {
                        console.log("Before update - obj:", obj);  // Debug log
                        console.log("Hearsay analysis:", hearsayAnalysis);  // Debug log
                        
                        const updatedObj = {
                            ...obj,
                            title: hearsayAnalysis.hearsay_type || obj.type,  // Use hearsay_type instead of type
                            type: hearsayAnalysis.hearsay_type || obj.type,   // Use hearsay_type instead of type
                            explanation: hearsayAnalysis.explanation || obj.explanation,
                            response: hearsayAnalysis.response,
                            hearsay_analysis: hearsayAnalysis
                        };
                        
                        console.log("After update - obj:", updatedObj);  // Debug log
                        return updatedObj;
                    }
                    return obj;
                });

                // Display updated results
                displayResults({
                    labeled_script: labelData.labeled_script,
                    objections: currentObjections
                });
            }

            // Step 6: Analyze Character Evidence (if any)
            const characterObjections = currentObjections.filter(
                obj => obj.type.toLowerCase().includes('character')
            );

            if (characterObjections.length > 0) {
                await updateLoadingStatus('Analyzing character evidence objections...');
                console.log("Character evidence objections to analyze:", characterObjections);
                
                const characterResponse = await fetch(`${API_URL}/analyze-character-evidence`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        character_objections: characterObjections,
                        labeled_script: labelData.labeled_script,
                        side: document.getElementById('side').value,
                        case_type: caseType,
                        is_homicide: caseSettings.charges?.some(charge => 
                            charge.toLowerCase().includes('homicide') || 
                            charge.toLowerCase().includes('murder')
                        ) || false,
                        defendant: caseSettings.defendant || '',
                        victim: caseSettings.victim || '',
                        case_theory: caseSettings.caseTheory || ''
                    })
                });

                if (!characterResponse.ok) throw new Error(`Character evidence analysis failed: ${characterResponse.status}`);
                const characterData = await characterResponse.json();
                console.log("Character evidence analysis response:", characterData);

                // Update objections with character evidence analysis
                currentObjections = currentObjections.map(obj => {
                    const characterAnalysis = characterData.find(a => a.id === obj.id);
                    if (characterAnalysis) {
                        console.log("Found character analysis for objection", obj.id, characterAnalysis);
                        return {
                            ...obj,
                            type: characterAnalysis.type || obj.type,
                            explanation: characterAnalysis.explanation || obj.explanation,
                            response: characterAnalysis.response,
                            riskLevel: obj.riskLevel
                        };
                    }
                    return obj;
                });

                // Update display with character evidence analysis
                displayResults({
                    labeled_script: labelData.labeled_script,
                    objections: currentObjections
                });
                console.log("displayed results with character evidence");
            }

            await updateLoadingStatus('Analysis complete!');
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            loadingOverlay.remove();
            
        } catch (error) {
            console.error('Error:', error);
            await updateLoadingStatus('Error: ' + error.message);
            await new Promise(resolve => setTimeout(resolve, 3000));
            loadingOverlay.remove();
        }
    });

    // Toggle settings panel
    settingsButton.addEventListener('click', () => {
        settingsPanel.classList.add('active');
        settingsOverlay.classList.add('active');
    });

    // Close settings panel
    closeSettings.addEventListener('click', () => {
        settingsPanel.classList.remove('active');
        settingsOverlay.classList.remove('active');
    });

    // Close on overlay click
    settingsOverlay.addEventListener('click', () => {
        settingsPanel.classList.remove('active');
        settingsOverlay.classList.remove('active');
    });

    // Debug check for toggle switch
    console.log('Initial toggle switch state:', {
        element: toggleSwitch,
        checked: toggleSwitch?.checked
    });

    if (!toggleSwitch) {
        console.error('Toggle switch not found! Check HTML ID');
        // Let's also check if it exists with different selectors
        console.log('Trying other selectors:', {
            byName: document.querySelector('input[name="showRemoved"]'),
            byClass: document.querySelector('.toggle-switch input'),
            allInputs: document.querySelectorAll('input[type="checkbox"]')
        });
    } else {
        console.log('Toggle switch found, adding event listener');
        toggleSwitch.addEventListener('change', function(e) {
            console.log('Toggle event fired:', {
                event: e,
                checked: e.target.checked,
                currentState: showRemovedComments
            });
            
            showRemovedComments = e.target.checked;
            
            // Toggle visibility of removed comments
            const removedComments = document.querySelectorAll('.comment[data-risk-level="Removed"]');
            console.log('Found removed comments:', {
                count: removedComments.length,
                elements: removedComments
            });
            
            removedComments.forEach((comment, i) => {
                const newDisplay = showRemovedComments ? 'block' : 'none';
                console.log(`Setting comment ${i} display:`, {
                    before: comment.style.display,
                    after: newDisplay,
                    riskLevel: comment.dataset.riskLevel
                });
                comment.style.display = newDisplay;
            });

            // Toggle highlight styling (not visibility) for removed objections
            const removedHighlights = document.querySelectorAll('.highlighted-text[data-risk-level="Removed"]');
            removedHighlights.forEach(highlight => {
                if (showRemovedComments) {
                    highlight.classList.add('highlighted-text');
                } else {
                    highlight.classList.remove('highlighted-text');
                }
            });
        });
    }

    function displayResults(data) {
        commentsContainer.innerHTML = '';
        editor.innerHTML = editor.dataset.originalScript || editor.innerText;
        
        if (!data.objections || !Array.isArray(data.objections)) {
            console.error("No objections array in data:", data);
            return;
        }
        
        data.objections.forEach((objection) => {
            const commentEl = document.createElement('div');
            commentEl.className = 'comment';
            commentEl.dataset.commentId = `comment-${objection.id}`;
            
            if (objection.riskLevel) {
                commentEl.dataset.riskLevel = objection.riskLevel;
                console.log(`Setting risk level for comment ${objection.id}:`, {
                    riskLevel: objection.riskLevel,
                    dataset: commentEl.dataset.riskLevel,
                    shouldHide: objection.riskLevel === "Removed" && !showRemovedComments
                });
                
                if (objection.riskLevel === "Removed" && !showRemovedComments) {
                    commentEl.style.display = 'none';
                }
            }

            // Handle hearsay analysis
            let objectionTitle = objection.type;
            let explanation = objection.explanation;
            let sampleResponse = '';

            if (objection.type.toLowerCase() === 'hearsay' && objection.hearsay_analysis) {
                // Now using structured JSON instead of regex parsing
                objectionTitle = objection.hearsay_analysis.type;
                explanation = objection.hearsay_analysis.explanation;
                
                // Add exception type if it exists
                if (objection.hearsay_analysis.exception_type) {
                    explanation = `Exception: ${objection.hearsay_analysis.exception_type}\n\n${explanation}`;
                }
                
                // Get response if available
                if (objection.hearsay_analysis.response) {
                    sampleResponse = objection.hearsay_analysis.response;
                }
            }
            
            const commentHTML = `
                <div class="comment-header">
                    <div class="comment-type">${objectionTitle}</div>
                    ${objection.riskLevel ? `
                        <div class="risk-level-container">
                            <span class="risk-level ${objection.riskLevel}" data-objection-id="${objection.id}">
                                ${objection.riskLevel}
                            </span>
                            ${objection.riskExplanation ? `
                                <div class="risk-tooltip" data-objection-id="${objection.id}">
                                    ${marked.parse(objection.riskExplanation)}
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
                <div class="comment-text" data-objection-id="${objection.id}">${marked.parse(explanation)}</div>
                ${sampleResponse ? `
                    <button class="sample-response-btn" data-objection-id="${objection.id}">View Sample Response</button>
                    <div class="comment-response hidden" data-objection-id="${objection.id}">${marked.parse(sampleResponse)}</div>
                ` : ''}
            `;
            
            commentEl.innerHTML = commentHTML;
            commentsContainer.appendChild(commentEl);
            
            // Add click handler to highlight corresponding text and scroll to it
            commentEl.addEventListener('click', (e) => {
                // Ignore if clicking the sample response button
                if (e.target.classList.contains('sample-response-btn')) {
                    return;
                }

                // Remove all previous active states
                document.querySelectorAll('.comment').forEach(el => {
                    el.classList.remove('active-comment');
                    // Hide all sample response buttons and responses
                    const btn = el.querySelector('.sample-response-btn');
                    const response = el.querySelector('.comment-response');
                    if (btn) btn.classList.add('hidden');
                    if (response) {
                        response.classList.add('hidden');
                        btn.textContent = 'View Sample Response';
                    }
                });
                document.querySelectorAll('.highlighted-text').forEach(el => {
                    el.classList.remove('active-highlight');
                });
                
                // Add active state to this comment
                commentEl.classList.add('active-comment');
                
                // Show sample response button if it exists
                const responseBtn = commentEl.querySelector('.sample-response-btn');
                if (responseBtn) {
                    responseBtn.classList.remove('hidden');
                }
                
                // Find and highlight corresponding text
                const highlightId = `highlight-${objection.id}`;
                const highlightEl = document.querySelector(`[data-highlight-id="${highlightId}"]`);
                if (highlightEl) {
                    highlightEl.classList.add('active-highlight');
                    highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });

            // Add click handler for sample response button
            const responseBtn = commentEl.querySelector('.sample-response-btn');
            if (responseBtn) {
                responseBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent triggering comment click
                    const responseEl = commentEl.querySelector('.comment-response');
                    responseEl.classList.toggle('hidden');
                    responseBtn.textContent = responseEl.classList.contains('hidden') 
                        ? 'View Sample Response' 
                        : 'Hide Sample Response';
                });
            }

            // When objection data comes in, let's log it
            console.log(`Objection ${objection.id}:`, {
                type: objection.type,
                riskLevel: objection.riskLevel,
                dataset: commentEl.dataset.riskLevel
            });
        });
        
        highlightAllText(data.objections);
        
        // Apply initial visibility state to highlights
        if (!showRemovedComments) {
            const removedHighlights = document.querySelectorAll('.highlighted-text[data-risk-level="Removed"]');
            removedHighlights.forEach(highlight => {
                highlight.style.display = 'none';
            });
        }
    }

    function highlightAllText(objections) {
        let content = editor.innerHTML;
        const labeledScript = JSON.parse(editor.dataset.labeledScript);
        
        objections.forEach((objection) => {
            if (!objection.sentence) {
                console.log(`No sentence for objection ${objection.id}:`, objection);
                return;
            }
            
            // Get the actual text from labeled script using the sentence number
            const sentenceText = labeledScript[objection.sentence];
            if (!sentenceText) {
                console.log(`No text found in labeled script for sentence ${objection.sentence}`);
                return;
            }
            
            const escapedText = sentenceText
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .trim();
                
            if (!findText(content, sentenceText)) {
                console.log(`Text not found for objection ${objection.id}: "${sentenceText}"`);
                return;
            }
            
            const regex = new RegExp(`(${escapedText})`, 'gi');
            const highlightId = `highlight-${objection.id}`;
            
            const riskLevelClass = objection.riskLevel ? 
                ` risk-${objection.riskLevel}` : '';
            
            content = content.replace(
                regex,
                `<span class="highlighted-text${riskLevelClass}" 
                    data-highlight-id="${highlightId}" 
                    data-objection-id="${objection.id}"
                    data-risk-level="${objection.riskLevel || 'none'}">\$1</span>`
            );
        });
        
        editor.innerHTML = content;
        
        if (!showRemovedComments) {
            const removedHighlights = document.querySelectorAll('.highlighted-text[data-risk-level="Removed"]');
            removedHighlights.forEach(highlight => {
                highlight.classList.remove('highlighted-text');
            });
        }
    }

    function normalizeText(text) {
        return text
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function findText(content, searchText) {
        // Normalize both strings
        const normalizedContent = normalizeText(content);
        const normalizedSearch = normalizeText(searchText);
        
        // Create a more flexible regex that allows for some variation
        const searchRegex = new RegExp(
            normalizedSearch
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
                .replace(/\s+/g, '\\s+'), // Allow flexible whitespace
            'i' // Case insensitive
        );
        
        return searchRegex.test(normalizedContent);
    }

    // File input styling
    const fileInputElement = document.querySelector('#scriptFile');
    const fileLabel = document.querySelector('.file-input-label');
    const fileNameSpan = document.querySelector('.file-name');
    const defaultText = document.querySelector('.file-input-text');

    fileInputElement.addEventListener('change', function(e) {
        if (this.files && this.files[0]) {
            const fileName = this.files[0].name;
            fileNameSpan.textContent = fileName;
            defaultText.textContent = 'Selected file:';
            fileLabel.classList.add('has-file');
        } else {
            fileNameSpan.textContent = '';
            defaultText.textContent = 'Choose a file or drag it here';
            fileLabel.classList.remove('has-file');
        }
    });

    // Add drag and drop support
    fileLabel.addEventListener('dragover', function(e) {
        e.preventDefault();
        this.classList.add('has-file');
    });

    fileLabel.addEventListener('dragleave', function(e) {
        e.preventDefault();
        if (!fileInput.files.length) {
            this.classList.remove('has-file');
        }
    });

    fileLabel.addEventListener('drop', function(e) {
        e.preventDefault();
        fileInput.files = e.dataTransfer.files;
        if (fileInput.files.length) {
            const fileName = fileInput.files[0].name;
            fileNameSpan.textContent = fileName;
            defaultText.textContent = 'Selected file:';
            this.classList.add('has-file');
            
            // Trigger the change event manually
            const changeEvent = new Event('change');
            fileInput.dispatchEvent(changeEvent);
        }
    });

    // Case Settings Modal
    const caseSettingsBtn = document.querySelector('.case-settings-btn');
    const caseSettingsModal = document.querySelector('.case-settings-modal');
    const caseSettingsOverlay = document.querySelector('.case-settings-overlay');
    const closeCaseSettings = document.querySelector('.close-case-settings');
    const caseSettingsForm = document.getElementById('caseSettingsForm');
    const chargeSelect = document.getElementById('chargeSelect');
    const otherCharge = document.getElementById('otherCharge');
    const addChargeBtn = document.querySelector('.add-charge-btn');
    const selectedCharges = document.querySelector('.selected-charges');
    const sideSelect = document.getElementById('side');

    // Function to update side options based on case type
    function updateSideOptions(isCivil) {
        const prosecutionOption = sideSelect.querySelector('option[value="prosecution"]');
        if (isCivil) {
            prosecutionOption.textContent = 'Plaintiff';
        } else {
            prosecutionOption.textContent = 'Prosecution';
        }
    }

    // Open Case Settings
    caseSettingsBtn.addEventListener('click', () => {
        caseSettingsModal.classList.add('active');
        caseSettingsOverlay.classList.add('active');
    });

    // Close Case Settings
    function closeCaseSettingsModal() {
        caseSettingsModal.classList.remove('active');
        caseSettingsOverlay.classList.remove('active');
    }

    closeCaseSettings.addEventListener('click', closeCaseSettingsModal);
    caseSettingsOverlay.addEventListener('click', closeCaseSettingsModal);

    // Handle Case Type Toggle
    const caseTypeInputs = document.querySelectorAll('input[name="caseType"]');
    caseTypeInputs.forEach(input => {
        input.addEventListener('change', () => {
            const isCivil = input.value === 'civil';
            
            // Update side options
            updateSideOptions(isCivil);
            
            // Update charges display
            document.querySelectorAll('.criminal-charges option').forEach(opt => {
                opt.style.display = isCivil ? 'none' : '';
            });
            document.querySelectorAll('.civil-claims option').forEach(opt => {
                opt.style.display = isCivil ? '' : 'none';
            });
            chargeSelect.value = '';
        });
    });

    // Handle Other Charge Input
    otherCharge.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const chargeText = this.value.trim();
            if (chargeText) {
                addCharge(chargeText);
                this.value = '';
                this.style.display = 'none';
                document.getElementById('chargeSelect').value = '';
            }
        }
    });

    // Add Charge
    addChargeBtn.addEventListener('click', () => {
        const selectedValue = chargeSelect.value;
        if (!selectedValue) return;

        const chargeText = selectedValue.includes('other') 
            ? otherCharge.value 
            : chargeSelect.options[chargeSelect.selectedIndex].text;

        if (!chargeText) return;

        const chargeTag = document.createElement('div');
        chargeTag.className = 'charge-tag';
        chargeTag.innerHTML = `
            ${chargeText}
            <span class="remove-charge material-icons">close</span>
        `;

        chargeTag.querySelector('.remove-charge').addEventListener('click', () => {
            chargeTag.remove();
        });

        selectedCharges.appendChild(chargeTag);
        chargeSelect.value = '';
        otherCharge.style.display = 'none';
        otherCharge.value = '';
    });

    // Case Settings Form Submit Handler
    caseSettingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Remove any existing invalid markers
        document.querySelectorAll('.field-invalid').forEach(field => {
            field.classList.remove('field-invalid');
        });
        
        // Check required fields
        const defendant = document.getElementById('defendantName');
        const victim = document.getElementById('victimName');
        const caseTheory = document.getElementById('caseTheory');
        const charges = Array.from(selectedCharges.children);
        
        const missingFields = [];
        if (!defendant.value.trim()) {
            missingFields.push('Defendant Name');
            defendant.classList.add('field-invalid');
        }
        if (!victim.value.trim()) {
            missingFields.push('Victim Name');
            victim.classList.add('field-invalid');
        }
        if (!caseTheory.value.trim()) {
            missingFields.push('Case Theory');
            caseTheory.classList.add('field-invalid');
        }
        if (charges.length === 0) {
            missingFields.push('Charges/Claims');
            document.getElementById('chargeSelect').classList.add('field-invalid');
        }

        if (missingFields.length > 0) {
            alert(`Please fill in the following required fields:\n- ${missingFields.join('\n- ')}`);
            return;
        }

        // If all required fields are filled, save settings
        const chargeTexts = charges.map(tag => tag.textContent.trim());
        const caseSettings = {
            caseType: document.querySelector('input[name="caseType"]:checked').value,
            charges: chargeTexts,
            defendant: defendant.value.trim(),
            victim: victim.value.trim() || 'no victim',  // Default to 'no victim' if empty
            caseTheory: caseTheory.value.trim(),
            p_party_representative: document.getElementById('pPartyRep').value.trim(),
            isHomicide: chargeTexts.some(charge => 
                charge.toLowerCase().includes('homicide') || 
                charge.toLowerCase().includes('murder')
            )
        };

        // Store settings in localStorage
        localStorage.setItem('caseSettings', JSON.stringify(caseSettings));
        
        // Close the modal and overlay
        const caseSettingsModal = document.querySelector('.case-settings-modal');
        const caseSettingsOverlay = document.querySelector('.case-settings-overlay');
        
        caseSettingsModal.classList.remove('active');
        caseSettingsOverlay.classList.remove('active');
    });

    // Initialize side options and charges based on default criminal case type
    updateSideOptions(false);
    
    // Show criminal charges and hide civil claims initially
    document.querySelectorAll('.criminal-charges option').forEach(opt => {
        opt.style.display = '';
    });
    document.querySelectorAll('.civil-claims option').forEach(opt => {
        opt.style.display = 'none';
    });

    // Store initial settings if none exist
    if (!localStorage.getItem('caseSettings')) {
        const initialSettings = {
            caseType: 'criminal',
            charges: [],
            defendant: '',
            victim: '',
            caseTheory: '',
            p_party_representative: ''
        };
        localStorage.setItem('caseSettings', JSON.stringify(initialSettings));
    }

    // Replace or modify the charge select handler
    document.getElementById('chargeSelect').addEventListener('change', function() {
        const selectedValue = this.value;
        if (!selectedValue) return; // Skip if no value selected
        
        // If "other" is selected, show the input field
        if (selectedValue === 'other-criminal' || selectedValue === 'other-civil') {
            document.getElementById('otherCharge').style.display = 'block';
            return;
        }
        
        // Otherwise, add the selected charge directly
        const selectedText = this.options[this.selectedIndex].text;
        addCharge(selectedText);
        
        // Reset the select to default option
        this.value = '';
    });

    // Keep your existing addCharge function
    function addCharge(chargeText) {
        const selectedCharges = document.querySelector('.selected-charges');
        
        // Check if charge already exists
        if (Array.from(selectedCharges.children).some(tag => tag.textContent.trim() === chargeText)) {
            return;
        }
        
        const chargeTag = document.createElement('div');
        chargeTag.className = 'charge-tag';
        chargeTag.innerHTML = `
            ${chargeText}
            <span class="remove-charge material-icons">close</span>
        `;
        
        chargeTag.querySelector('.remove-charge').addEventListener('click', function() {
            chargeTag.remove();
        });
        
        selectedCharges.appendChild(chargeTag);
    }

    // Add this to your existing case type change handler
    document.querySelectorAll('input[name="caseType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const isCriminal = e.target.value === 'criminal';
            document.querySelector('.criminal-label').style.display = isCriminal ? 'inline' : 'none';
            document.querySelector('.civil-label').style.display = isCriminal ? 'none' : 'inline';
        });
    });

    // Show/hide expert field based on witness type selection
    const witnessTypeSelect = document.getElementById('witnessType');
    const expertFieldContainer = document.querySelector('.expert-field-container');
    const expertFieldInput = document.getElementById('expertField');

    // Set initial state
    expertFieldContainer.style.display = 'none';
    expertFieldInput.required = false;

    witnessTypeSelect.addEventListener('change', function() {
        if (this.value === 'expert witness') {
            expertFieldContainer.style.display = 'block';
            expertFieldInput.required = true;
        } else {
            expertFieldContainer.style.display = 'none';
            expertFieldInput.required = false;
        }
    });
}); 