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
                }
                .healthguard-highlight-accurate:hover::after {
                    content: "✅ Verified as Accurate";
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #2e7d32;
                    color: white;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                    white-space: nowrap;
                    z-index: 1001;
                }
                .healthguard-highlight-misleading:hover::after {
                    content: "❌ Potentially Misleading";
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #c62828;
                    color: white;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                    white-space: nowrap;
                    z-index: 1001;
                }
            `;
            document.head.appendChild(style);
        }

        // Use TreeWalker to find and highlight text nodes without breaking the DOM
        claims.forEach(claim => {
            const classification = claim.classification.toLowerCase();
            let highlightClass = '';

            if (classification === 'accurate') {
                highlightClass = 'healthguard-highlight-accurate';
            } else if (classification === 'misleading') {
                highlightClass = 'healthguard-highlight-misleading';
            }

            if (highlightClass) {
                highlightTextInDOM(claim.claim_text, highlightClass, claim.classification);
            }
        });

        console.log('[content.js] Highlighting complete.');
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
                        node.parentElement.tagName === 'SCRIPT' ||
                        node.parentElement.tagName === 'STYLE') {
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
                    `<span class="${className}" title="HealthGuard: ${classification}">${match}</span>`
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

    function escapeRegex(string) {
        return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
}