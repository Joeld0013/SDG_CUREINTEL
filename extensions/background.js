const API_URL = "http://localhost:5000/scan-page";

// Keep your existing side panel behavior.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Side panel setup error:', error));

// Add a new listener for messages from other parts of the extension.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // When the panel sends the "scanPage" action...
    if (request.action === "scanPage") {
        console.log('[background.js] Received "scanPage" message from panel.');
        // Inject the content.js script into the active tab.
        chrome.scripting.executeScript({
            target: { tabId: request.tabId },
            files: ['content.js']
        }, (injectionResults) => {
            if (chrome.runtime.lastError) {
                console.error('[background.js] Script injection failed:', chrome.runtime.lastError);
                return;
            }
            console.log('[background.js] Injected content.js. Now sending "getText" message.');
            // After injection, send a message to content.js to start the text extraction.
            chrome.tabs.sendMessage(request.tabId, { action: "getText" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[background.js] Error sending getText message:', chrome.runtime.lastError);
                }
            });
        });
    }

    // When content.js sends back the page text...
    if (request.action === "sendText") {
        console.log('[background.js] Received "sendText" message with page text.');
        console.log('[background.js] Text length:', request.text.length);
        
        // Send the text to your Flask backend for analysis.
        fetch(API_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ text: request.text })
        })
        .then(response => {
            console.log('[background.js] Backend response status:', response.status);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('[background.js] Received analysis from backend:', data);
            console.log('[background.js] Number of claims found:', data.claims ? data.claims.length : 0);
            
            // Send the results (the list of claims) back to content.js to be highlighted.
            chrome.tabs.sendMessage(sender.tab.id, {
                action: "highlightClaims",
                claims: data.claims || []
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[background.js] Error sending highlightClaims message:', chrome.runtime.lastError);
                } else {
                    console.log('[background.js] Successfully sent "highlightClaims" message to content.js.');
                }
            });
        })
        .catch(error => {
            console.error('[background.js] Error sending text to backend:', error);
            // Optionally notify the user of the error
            chrome.tabs.sendMessage(sender.tab.id, {
                action: "showError",
                message: "Failed to analyze page content. Please check if the backend server is running."
            });
        });
    }
    
    // Return true to indicate you will send a response asynchronously.
    return true; 
});