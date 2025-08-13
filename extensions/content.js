// This check ensures the script's main logic only runs once per page load.
if (!window.hasRun) {
    window.hasRun = true;

    console.log('[content.js] Script injected and running.');

    // Listen for messages from the background script.
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // When the background script asks for the page text...
        if (request.action === "getText") {
            console.log('[content.js] Received "getText" message.');
            const pageText = document.body.innerText.trim();
            
            // Only send the message back if there is actual text to analyze.
            if (pageText) {
                chrome.runtime.sendMessage({
                    action: "sendText",
                    text: pageText 
                });
                console.log('[content.js] Sent page text back to background script.');
            } else {
                console.log('[content.js] No readable text found on the page. Halting scan.');
            }
        }

        // When the background script sends back the analyzed claims...
        if (request.action === "highlightClaims") {
            console.log('[content.js] Received "highlightClaims" message with claims:', request.claims);
            if (request.claims && request.claims.length > 0) {
                highlightClaimsOnPage(request.claims);
            } else {
                console.log('[content.js] No claims to highlight.');
            }
        }

        // Handle error messages from background script
        if (request.action === "showError") {
            console.log('[content.js] Received error message:', request.message);
            showErrorNotification(request.message);
        }

        return true;
    });

    function highlightClaimsOnPage(claims) {
        console.log('[content.js] Starting to highlight claims on page.');
        
        // Add styles only once
        if (!document.getElementById('healthguard-styles')) {
            const style = document.createElement('style');
            style.id = 'healthguard-styles';
            style.innerHTML = `
                .healthguard-highlight-accurate {
                    background-color: rgba(76, 175, 80, 0.3) !important;
                    border: 2px solid #4caf50 !important;
                    border-radius: 4px !important;
                    padding: 2px 4px !important;
                    margin: 0 2px !important;
                    box-shadow: 0 2px 4px rgba(76, 175, 80, 0.2) !important;
                    position: relative !important;
                    z-index: 1000 !important;
                    cursor: help !important;
                }
                .healthguard-highlight-misleading {
                    background-color: rgba(244, 67, 54, 0.3) !important;
                    border: 2px solid #f44336 !important;
                    border-radius: 4px !important;
                    padding: 2px 4px !important;
                    margin: 0 2px !important;
                    box-shadow: 0 2px 4px rgba(244, 67, 54, 0.2) !important;
                    position: relative !important;
                    z-index: 1000 !important;
                    cursor: help !important;
                }
                .healthguard-highlight-unverifiable {
                    background-color: rgba(255, 152, 0, 0.3) !important;
                    border: 2px solid #ffa726 !important;
                    border-radius: 4px !important;
                    padding: 2px 4px !important;
                    margin: 0 2px !important;
                    box-shadow: 0 2px 4px rgba(255, 152, 0, 0.2) !important;
                    position: relative !important;
                    z-index: 1000 !important;
                    cursor: help !important;
                }
                .healthguard-highlight-accurate:hover::after {
                    content: "✅ HealthGuard: Verified as Accurate";
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #2e7d32;
                    color: white;
                    padding: 6px 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    white-space: nowrap;
                    z-index: 1001;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-weight: 500;
                }
                .healthguard-highlight-misleading:hover::after {
                    content: "❌ HealthGuard: Potentially Misleading";
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #c62828;
                    color: white;
                    padding: 6px 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    white-space: nowrap;
                    z-index: 1001;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-weight: 500;
                }
                .healthguard-highlight-unverifiable:hover::after {
                    content: "❔ HealthGuard: Unverifiable Claim";
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #ef6c00;
                    color: white;
                    padding: 6px 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    white-space: nowrap;
                    z-index: 1001;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-weight: 500;
                }
                .healthguard-error-notification {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #f44336;
                    color: white;
                    padding: 12px 16px;
                    border-radius: 8px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-size: 14px;
                    z-index: 10000;
                    box-shadow: 0 4px 12px rgba(244, 67, 54, 0.4);
                    max-width: 300px;
                    word-wrap: break-word;
                    animation: slideInRight 0.3s ease-out;
                }
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                .healthguard-summary-banner {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    background: linear-gradient(135deg, #4caf50, #66bb6a);
                    color: white;
                    padding: 12px;
                    text-align: center;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-size: 14px;
                    font-weight: 500;
                    z-index: 9999;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                    animation: slideInDown 0.5s ease-out;
                }
                @keyframes slideInDown {
                    from { transform: translateY(-100%); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        // Remove any existing banner
        const existingBanner = document.getElementById('healthguard-summary-banner');
        if (existingBanner) {
            existingBanner.remove();
        }

        // Calculate statistics for summary banner
        const totalClaims = claims.length;
        const accurateCount = claims.filter(claim => claim.classification === 'Accurate').length;
        const misleadingCount = claims.filter(claim => claim.classification === 'Misleading').length;
        const unverifiableCount = claims.filter(claim => claim.classification === 'Unverifiable').length;

        // Show summary banner
        if (totalClaims > 0) {
            const summaryBanner = document.createElement('div');
            summaryBanner.id = 'healthguard-summary-banner';
            summaryBanner.className = 'healthguard-summary-banner';
            summaryBanner.innerHTML = `
                🏥 HealthGuard Analysis: ${totalClaims} health claims found • 
                ✅ ${accurateCount} Accurate • 
                ❌ ${misleadingCount} Misleading • 
                ❔ ${unverifiableCount} Unverifiable
            `;
            
            // Add click to dismiss
            summaryBanner.style.cursor = 'pointer';
            summaryBanner.title = 'Click to dismiss';
            summaryBanner.addEventListener('click', () => {
                summaryBanner.remove();
            });
            
            // Auto-dismiss after 5 seconds
            setTimeout(() => {
                if (summaryBanner.parentNode) {
                    summaryBanner.remove();
                }
            }, 5000);
            
            document.body.appendChild(summaryBanner);
        }

        // Use TreeWalker to find and highlight text nodes without breaking the DOM
        claims.forEach(claim => {
            const classification = claim.classification.toLowerCase();
            let highlightClass = '';

            if (classification === 'accurate') {
                highlightClass = 'healthguard-highlight-accurate';
            } else if (classification === 'misleading') {
                highlightClass = 'healthguard-highlight-misleading';
            } else if (classification === 'unverifiable') {
                highlightClass = 'healthguard-highlight-unverifiable';
            }

            if (highlightClass) {
                highlightTextInDOM(claim.claim_text, highlightClass, claim.classification);
            }
        });

        console.log('[content.js] Highlighting complete.');
        
        // Scroll to first highlighted element if any
        const firstHighlight = document.querySelector('[class*="healthguard-highlight-"]');
        if (firstHighlight) {
            setTimeout(() => {
                firstHighlight.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }, 500);
        }
    }

    function highlightTextInDOM(searchText, className, classification) {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    // Skip already highlighted content and script/style tags
                    if (node.parentElement.classList.contains('healthguard-highlight-accurate') ||
                        node.parentElement.classList.contains('healthguard-highlight-misleading') ||
                        node.parentElement.classList.contains('healthguard-highlight-unverifiable') ||
                        node.parentElement.tagName === 'SCRIPT' ||
                        node.parentElement.tagName === 'STYLE' ||
                        node.parentElement.id === 'healthguard-summary-banner') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }

        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const regex = new RegExp(escapeRegex(searchText), "gi");
            
            if (regex.test(text)) {
                const highlightedHTML = text.replace(regex, (match) => 
                    <span class="${className}" title="HealthGuard: ${classification}" data-claim="${escapeHtml(searchText)}">${match}</span>
                );
                
                // Create a temporary container to convert HTML string to DOM elements
                const temp = document.createElement('div');
                temp.innerHTML = highlightedHTML;
                
                // Replace the text node with the highlighted content
                const parent = textNode.parentNode;
                while (temp.firstChild) {
                    parent.insertBefore(temp.firstChild, textNode);
                }
                parent.removeChild(textNode);
            }
        });
    }

    function showErrorNotification(message) {
        // Remove any existing error notifications
        const existingNotification = document.getElementById('healthguard-error-notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        // Create new error notification
        const notification = document.createElement('div');
        notification.id = 'healthguard-error-notification';
        notification.className = 'healthguard-error-notification';
        notification.innerHTML = `
            <strong>HealthGuard Error:</strong><br>
            ${escapeHtml(message)}
        `;
        
        // Add click to dismiss
        notification.style.cursor = 'pointer';
        notification.title = 'Click to dismiss';
        notification.addEventListener('click', () => {
            notification.remove();
        });
        
        // Auto-dismiss after 8 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 8000);
        
        document.body.appendChild(notification);
    }

    // Utility functions
    function escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    console.log('[content.js] Script initialization complete.');
}