from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
import os
import json
import logging
import base64
from io import BytesIO
from PIL import Image
import re

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Set your Gemini API key here
# IMPORTANT: For security, use environment variables in production instead of hardcoding keys.
API_KEY = "AIzaSyCgIMjEJAEmRPRieeG4mhartrjb20MJdfM"  # Replace with your actual API key
os.environ["GOOGLE_API_KEY"] = API_KEY
genai.configure(api_key=API_KEY)

# Original prompt for fact-checking mode
PROMPT_TEMPLATE = """
You are HealthGuard AI, a friendly and authoritative medical fact-checking assistant. Your primary goal is to verify health-related claims and provide clear, helpful, and easy-to-understand explanations based on trusted medical sources.

Input type: {type}  // text | link | image_text
Content: {content}

**Instructions:**

1.  **Analyze the Content:** First, determine if the user's input (which could be text, an image, or both) contains a health-related claim.
    * **If NOT health-related**, return the following JSON object immediately and stop:
        `{{"is_health_related": false, "message": "This does not appear to be a health-related question. I can only validate medical claims."}}`

2.  **Verify the Claim:** If the content is health-related, rigorously check the claim against reliable medical sources like the WHO, CDC, Mayo Clinic, NIH, and PubMed.

3.  **Construct the JSON Response:** Based on your verification, create a single, valid JSON object with the following structure. Do NOT include any markdown formatting (like ```json) or extra text outside the JSON object.

    * `"is_health_related"`: (boolean) `true`.
    * `"classification"`: (string) Choose one: "Accurate", "Misleading", or "Unverifiable".
    * `"confidence_score"`: (integer) Your certainty in the classification, from 0 to 100.
    * `"summary"`: (string) A brief, one-sentence summary of the verdict. This is the quick, direct answer. (e.g., "The claim that drinking water can cure cancer is false.")
    * `"explanation"`: (string) A clear, plain-language explanation.
    * `"correct_information"`: (string) Provide a brief overview of the correct information related to the topic.
    * `"sources"`: (array of objects) A list of source objects, where each object has:
        * `"name"`: (string) The name of the organization (e.g., "World Health Organization").
        * `"url"`: (string) The direct URL to the supporting article. Provide at least two sources if possible.
"""

# NEW: Advanced Doctor Mode prompt
DOCTOR_MODE_PROMPT = """
You are HealthGuard AI Doctor, an advanced AI medical assistant. You provide comprehensive, evidence-based medical information and guidance while maintaining the highest standards of medical accuracy.

Input type: {type}  // text | link | image_text
Content: {content}

**Your Role:**
- Act as a knowledgeable medical advisor
- Provide detailed, evidence-based medical information
- Offer practical health guidance and recommendations
- Always cite verified medical sources
- Maintain professional medical standards

**Instructions:**

1. **Health Relevance Check:** 
   * If the query is NOT health/medical related, return:
     `{{"is_health_related": false, "message": "I am HealthGuard AI Doctor and can only assist with health and medical questions. Please ask about symptoms, conditions, treatments, or other health-related topics."}}`

2. **Medical Response Framework:**
   * Provide comprehensive medical information
   * Include symptoms, causes, treatments, and prevention when relevant
   * Offer practical advice and recommendations
   * Always include important disclaimers about consulting healthcare professionals
   * Cite multiple verified medical sources

3. **Response Structure:** Create a JSON object with:
   * `"is_health_related"`: (boolean) `true`
   * `"response_type"`: (string) "medical_advice" 
   * `"condition_overview"`: (string) Brief overview of the condition/topic
   * `"detailed_explanation"`: (string) Comprehensive medical explanation
   * `"symptoms"`: (array of strings) Relevant symptoms if applicable
   * `"causes"`: (array of strings) Common causes if applicable  
   * `"treatments"`: (array of strings) Available treatment options
   * `"prevention"`: (string) Prevention strategies if applicable
   * `"when_to_seek_help"`: (string) When to consult a healthcare professional
   * `"important_notes"`: (string) Important disclaimers and additional information
   * `"verified_sources"`: (array of objects) Medical sources with:
     * `"name"`: (string) Source name (WHO, Mayo Clinic, NIH, etc.)
     * `"url"`: (string) Direct URL to source
     * `"credibility"`: (string) Why this source is trustworthy

**Important Guidelines:**
- Always recommend consulting healthcare professionals for diagnosis and treatment
- Provide evidence-based information only
- Include emergency warning signs when relevant
- Be comprehensive but clear and understandable
- Never provide specific medication dosages without emphasizing professional consultation
"""

# Scanner prompt remains the same
PROMPT_TEMPLATE_SCANNER = """
You are an AI model that functions as a precise health claim detector. Your task is to analyze a block of text from a webpage and identify all specific, verifiable health-related claims.

**CRITICAL INSTRUCTIONS:**

1.  **Analyze the Text:** Read the entire text provided and find health-related factual statements.
2.  **Identify Claims:** Find every distinct health-related statement presented as a fact. Look for statements like "X cures Y", "This supplement does Z", "Procedure A is B% effective", etc.
3.  **Verify and Classify:** For each claim, classify it as either "Accurate" or "Misleading" based on medical evidence.
4.  **Output Format:** You MUST respond with ONLY a valid JSON object. No markdown, no extra text, no explanations - just pure JSON.

The JSON structure must be:
{{
  "claims": [
    {{
      "claim_text": "exact text of the claim from the webpage",
      "classification": "Accurate" or "Misleading"
    }}
  ]
}}

If no health claims are found, return: {{"claims": []}}

REMEMBER: Output ONLY valid JSON. No ```json markdown, no explanations, just the JSON object.

Text to analyze: {text}
"""

@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "HealthGuard API is running",
        "version": "3.0",
        "endpoints": {
            "/validate": "POST - Validate a single health claim (text, link, or image)",
            "/doctor-mode": "POST - Advanced medical consultation mode",
            "/scan-page": "POST - Scan a block of text for multiple health claims"
        }
    })

@app.route("/validate", methods=["POST"])
def validate():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                "error": "No JSON data provided",
                "classification": "Error",
                "explanation": "Invalid request format",
                "sources": []
            }), 400
        
        input_type = data.get("type", "text")
        
        logger.info(f"Processing {input_type} validation request")
        
        model = genai.GenerativeModel("models/gemini-1.5-flash")
        
        if input_type == 'image_text':
            content_data = data.get("content", {})
            text_content = content_data.get("text", "")
            image_base64 = content_data.get("image_base64")

            if not image_base64:
                 return jsonify({"error": "Missing image data for image_text type"}), 400

            header, encoded = image_base64.split(",", 1)
            decoded_image = base64.b64decode(encoded)
            image_part = Image.open(BytesIO(decoded_image))
            
            prompt_content_for_template = text_content if text_content else "Analyze the attached image."
            prompt = PROMPT_TEMPLATE.format(type=input_type, content=prompt_content_for_template[:2000])
            
            response = model.generate_content([prompt, image_part])

        else:  # Handles 'text' and 'link'
            content = data.get("content", "").strip()
            if not content:
                return jsonify({"error": "No content provided", "classification": "Error", "explanation": "Empty content received", "sources": []}), 400
            
            prompt = PROMPT_TEMPLATE.format(type=input_type, content=content[:2000])
            response = model.generate_content(prompt)
        
        if not response or not response.text:
            raise Exception("No response from Gemini API")
        
        response_text = response.text.strip()
        
        if response_text.startswith("```json"):
            response_text = response_text[7:-3].strip()
        elif response_text.startswith("`"):
            response_text = response_text.strip("`").strip()

        try:
            output = json.loads(response_text)
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            logger.error(f"Raw response: {response_text}")
            return jsonify({
                "classification": "Unverifiable",
                "summary": "Could not process AI response.",
                "explanation": f"The response from the AI was not in a valid format. Raw response: {response_text[:200]}...",
                "sources": [],
                "error": "JSON parsing failed"
            }), 500
        
        logger.info(f"Validation complete: {output.get('classification', 'Unknown')}")
        return jsonify(output)
        
    except Exception as e:
        logger.error(f"Validation error: {str(e)}")
        return jsonify({
            "error": str(e),
            "classification": "Error",
            "explanation": f"An unexpected error occurred: {str(e)}",
            "sources": []
        }), 500

# NEW: Doctor Mode Endpoint
@app.route("/doctor-mode", methods=["POST"])
def doctor_mode():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                "error": "No JSON data provided",
                "response_type": "error",
                "detailed_explanation": "Invalid request format"
            }), 400
        
        input_type = data.get("type", "text")
        
        logger.info(f"Processing {input_type} doctor mode request")
        
        model = genai.GenerativeModel("models/gemini-1.5-flash")
        
        if input_type == 'image_text':
            content_data = data.get("content", {})
            text_content = content_data.get("text", "")
            image_base64 = content_data.get("image_base64")

            if not image_base64:
                 return jsonify({"error": "Missing image data for image_text type"}), 400

            header, encoded = image_base64.split(",", 1)
            decoded_image = base64.b64decode(encoded)
            image_part = Image.open(BytesIO(decoded_image))
            
            prompt_content_for_template = text_content if text_content else "Analyze the attached image for medical information."
            prompt = DOCTOR_MODE_PROMPT.format(type=input_type, content=prompt_content_for_template[:2000])
            
            response = model.generate_content([prompt, image_part])

        else:  # Handles 'text' and 'link'
            content = data.get("content", "").strip()
            if not content:
                return jsonify({
                    "error": "No content provided", 
                    "response_type": "error", 
                    "detailed_explanation": "Empty medical query received"
                }), 400
            
            prompt = DOCTOR_MODE_PROMPT.format(type=input_type, content=content[:2000])
            response = model.generate_content(prompt)
        
        if not response or not response.text:
            raise Exception("No response from Gemini API")
        
        response_text = response.text.strip()
        
        if response_text.startswith("```json"):
            response_text = response_text[7:-3].strip()
        elif response_text.startswith("`"):
            response_text = response_text.strip("`").strip()

        try:
            output = json.loads(response_text)
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error in doctor mode: {e}")
            logger.error(f"Raw response: {response_text}")
            return jsonify({
                "response_type": "error",
                "detailed_explanation": f"Could not process AI response. Raw response: {response_text[:200]}...",
                "error": "JSON parsing failed"
            }), 500
        
        logger.info(f"Doctor mode consultation complete: {output.get('response_type', 'Unknown')}")
        return jsonify(output)
        
    except Exception as e:
        logger.error(f"Doctor mode error: {str(e)}")
        return jsonify({
            "error": str(e),
            "response_type": "error",
            "detailed_explanation": f"An unexpected error occurred: {str(e)}"
        }), 500

def clean_response_text(text):
    """Clean up Gemini's response text to extract valid JSON"""
    text = text.strip()
    
    # Remove markdown code blocks
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    
    # Remove any leading/trailing backticks
    text = text.strip("`").strip()
    
    # Find JSON object boundaries
    start_idx = text.find('{')
    end_idx = text.rfind('}')
    
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        text = text[start_idx:end_idx + 1]
    
    return text.strip()

def calculate_statistics(claims):
    """Calculate percentage statistics for claims"""
    if not claims:
        return {
            "total_claims": 0,
            "accurate_count": 0,
            "misleading_count": 0,
            "unverifiable_count": 0,
            "accurate_percentage": 0,
            "misleading_percentage": 0,
            "unverifiable_percentage": 0
        }
    
    total_claims = len(claims)
    accurate_count = sum(1 for claim in claims if claim.get('classification') == 'Accurate')
    misleading_count = sum(1 for claim in claims if claim.get('classification') == 'Misleading')
    unverifiable_count = sum(1 for claim in claims if claim.get('classification') == 'Unverifiable')
    
    return {
        "total_claims": total_claims,
        "accurate_count": accurate_count,
        "misleading_count": misleading_count,
        "unverifiable_count": unverifiable_count,
        "accurate_percentage": round((accurate_count / total_claims) * 100) if total_claims > 0 else 0,
        "misleading_percentage": round((misleading_count / total_claims) * 100) if total_claims > 0 else 0,
        "unverifiable_percentage": round((unverifiable_count / total_claims) * 100) if total_claims > 0 else 0
    }

@app.route("/scan-page", methods=["POST"])
def scan_page():
    try:
        data = request.get_json()
        page_text = data.get("text")

        if not page_text:
            return jsonify({"error": "No text provided for scanning"}), 400

        logger.info("Processing page scan request...")
        logger.info(f"Text length: {len(page_text)}")
        
        # Limit text size to prevent API limits
        truncated_text = page_text[:15000] if len(page_text) > 15000 else page_text
        
        prompt = PROMPT_TEMPLATE_SCANNER.format(text=truncated_text)
        
        model = genai.GenerativeModel("models/gemini-1.5-flash")
        response = model.generate_content(prompt)

        if not response or not response.text:
            logger.error("No response from Gemini API")
            return jsonify({"claims": []}), 200

        # Clean up the response text
        response_text = clean_response_text(response.text)
        logger.info(f"Cleaned response text: {response_text[:200]}...")

        try:
            output = json.loads(response_text)
            if "claims" not in output:
                logger.warning("Response missing 'claims' key, creating empty claims array")
                output = {"claims": []}
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error during page scan: {e}")
            logger.error(f"Raw response: {response_text[:500]}...")
            # Try to extract claims manually as fallback
            output = {"claims": []}

        claims_count = len(output.get('claims', []))
        logger.info(f"Page scan complete. Found {claims_count} claims.")
        
        # Log each claim for debugging
        for i, claim in enumerate(output.get('claims', [])):
            logger.info(f"Claim {i+1}: {claim.get('claim_text', 'N/A')[:100]}... - {claim.get('classification', 'N/A')}")
        
        return jsonify(output)

    except Exception as e:
        logger.error(f"Page scan error: {str(e)}")
        return jsonify({"error": str(e), "claims": []}), 500

@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "healthy",
        "api_configured": bool(os.environ.get("GOOGLE_API_KEY")),
        "timestamp": "2024-01-01T00:00:00Z"
    })

if __name__ == "__main__":
    logger.info("🏥 Starting HealthGuard API Server...")
    logger.info("📊 Server will run on: http://localhost:5000")
    logger.info(f"🔑 API Key configured: {bool(API_KEY)}")
    logger.info("✅ CORS enabled for all origins")
    logger.info("🚀 Starting server...")
    app.run(debug=True, host="0.0.0.0", port=5000)