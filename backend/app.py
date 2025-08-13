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
API_KEY = "AIzaSyAkxgVMsFzFs6jPIVg_SrNCKSqjpprqTIw"  # Replace with your actual API key
os.environ["GOOGLE_API_KEY"] = API_KEY
genai.configure(api_key=API_KEY)

# Define verified medical sources
VERIFIED_MEDICAL_SOURCES = {
    # Government & International Health Organizations
    "World Health Organization (WHO)": "https://www.who.int",
    "Centers for Disease Control and Prevention (CDC)": "https://www.cdc.gov", 
    "National Institutes of Health (NIH)": "https://www.nih.gov",
    "U.S. Food & Drug Administration (FDA)": "https://www.fda.gov",
    "National Health Service (NHS)": "https://www.nhs.uk",
    "European Medicines Agency (EMA)": "https://www.ema.europa.eu",
    
    # Medical Reference & Research Databases
    "PubMed (U.S. National Library of Medicine)": "https://pubmed.ncbi.nlm.nih.gov",
    "MedlinePlus": "https://medlineplus.gov",
    "Cochrane Library": "https://www.cochranelibrary.com",
    "UpToDate": "https://www.uptodate.com",
    
    # Trusted Health Information Portals
    "Mayo Clinic": "https://www.mayoclinic.org",
    "Cleveland Clinic": "https://my.clevelandclinic.org", 
    "Johns Hopkins Medicine": "https://www.hopkinsmedicine.org",
    "Harvard Health Publishing": "https://www.health.harvard.edu",
    "WebMD": "https://www.webmd.com",
    "Healthline": "https://www.healthline.com"
}

# Updated PROMPT_TEMPLATE with strict source verification
PROMPT_TEMPLATE = """
You are HealthGuard AI, a medical fact-checking assistant. Your job is to analyze health claims and break them down into individual statements for verification.

Input type: {type}  // text | link | image_text
Content: {content}

**VERIFIED MEDICAL SOURCES - ALWAYS INCLUDE IN YOUR RESPONSE:**

🔹 **Government & International Health Organizations:**
• World Health Organization (WHO) – https://www.who.int
• Centers for Disease Control and Prevention (CDC) – https://www.cdc.gov
• National Institutes of Health (NIH) – https://www.nih.gov
• U.S. Food & Drug Administration (FDA) – https://www.fda.gov
• National Health Service (NHS) – https://www.nhs.uk
• European Medicines Agency (EMA) – https://www.ema.europa.eu

🔹 **Medical Reference & Research Databases:**
• PubMed (U.S. National Library of Medicine) – https://pubmed.ncbi.nlm.nih.gov
• MedlinePlus – https://medlineplus.gov
• Cochrane Library – https://www.cochranelibrary.com
• UpToDate – https://www.uptodate.com

🔹 **Trusted Health Information Portals:**
• Mayo Clinic – https://www.mayoclinic.org
• Cleveland Clinic – https://my.clevelandclinic.org
• Johns Hopkins Medicine – https://www.hopkinsmedicine.org
• Harvard Health Publishing – https://www.health.harvard.edu
• WebMD – https://www.webmd.com
• Healthline – https://www.healthline.com

**CRITICAL INSTRUCTIONS:**

1. **Check if this is asking for medical advice:** If the user is asking for medical advice, recommendations, or "what should I do" questions, return:
   `{{"is_health_related": false, "message": "I am HealthGuard AI, a fact-checker. I can only verify health claims and information, not provide medical advice or recommendations. Please consult a healthcare professional for medical guidance."}}`

2. **Break down into individual claims:** Extract ALL individual health-related factual statements from the input. Each statement should be analyzed separately.

3. **MANDATORY SOURCE INCLUSION:** You MUST ALWAYS include the "sources" array in your response with at least 3-5 relevant sources from the verified list above, regardless of the classification.

4. **For each claim, return:**
   * `"claim_text"`: The exact text of the individual claim
   * `"classification"`: "Accurate", "Misleading", or "Unverifiable" 
   * `"confidence_score"`: 0-100 confidence for this specific claim
   * `"explanation"`: Why this specific claim is accurate/misleading/unverifiable
   * `"correct_information"`: What the correct information should be for this claim

5. **Response format (MANDATORY):**
```json
{{
  "is_health_related": true,
  "total_claims": number,
  "accurate_count": number,
  "misleading_count": number,
  "unverifiable_count": number,
  "overall_accuracy_percentage": calculated_percentage,
  "claims": [
    {{
      "claim_text": "exact claim text",
      "classification": "Accurate|Misleading|Unverifiable",
      "confidence_score": number,
      "explanation": "detailed explanation for this claim",
      "correct_information": "what should be correct"
    }}
  ],
  "sources": [
    {{
      "name": "World Health Organization (WHO)",
      "url": "https://www.who.int"
    }},
    {{
      "name": "Centers for Disease Control and Prevention (CDC)",
      "url": "https://www.cdc.gov"
    }},
    {{
      "name": "Mayo Clinic",
      "url": "https://www.mayoclinic.org"
    }},
    {{
      "name": "National Institutes of Health (NIH)",
      "url": "https://www.nih.gov"
    }},
    {{
      "name": "MedlinePlus",
      "url": "https://medlineplus.gov"
    }}
  ],
  "summary": "Overall analysis summary with source-backed conclusions"
}}
```

**REMEMBER:** 
- Analyze EACH health claim individually, not the entire text as one claim
- ALWAYS include the "sources" array with real URLs from the verified list
- NEVER omit the sources section - it's mandatory for every response
- Always include at least 3-5 sources in the sources array
"""

# Updated DOCTOR_MODE_PROMPT with verified sources
DOCTOR_MODE_PROMPT = """
You are HealthGuard AI Doctor. Provide concise, helpful medical information from verified sources only.

Input type: {type}  // text | link | image_text
Content: {content}

**VERIFIED MEDICAL SOURCES - ALWAYS INCLUDE THESE IN RESPONSE:**

🔹 **Government & International Health Organizations:**
• World Health Organization (WHO) – https://www.who.int
• Centers for Disease Control and Prevention (CDC) – https://www.cdc.gov
• National Institutes of Health (NIH) – https://www.nih.gov
• U.S. Food & Drug Administration (FDA) – https://www.fda.gov
• National Health Service (NHS) – https://www.nhs.uk

🔹 **Medical Reference & Research Databases:**
• PubMed (U.S. National Library of Medicine) – https://pubmed.ncbi.nlm.nih.gov
• MedlinePlus – https://medlineplus.gov
• Cochrane Library – https://www.cochranelibrary.com

🔹 **Trusted Health Information Portals:**
• Mayo Clinic – https://www.mayoclinic.org
• Cleveland Clinic – https://my.clevelandclinic.org
• Johns Hopkins Medicine – https://www.hopkinsmedicine.org
• Harvard Health Publishing – https://www.health.harvard.edu

**Instructions:**

1. **Health Check:** If NOT health-related, return:
   `{{"is_health_related": false, "message": "I am HealthGuard AI Doctor. Please ask about health conditions, symptoms, or medical topics."}}`

2. **Provide CONCISE medical information:** Be brief but helpful. Focus on key points only.

3. **MANDATORY Response Structure:**
   * `"is_health_related"`: (boolean) `true`
   * `"response_type"`: (string) "medical_advice"
   * `"condition_overview"`: (string) 2-3 sentences maximum about the condition
   * `"detailed_explanation"`: (string) Brief, clear explanation (3-4 sentences max)
   * `"symptoms"`: (array) Key symptoms only (max 5)
   * `"causes"`: (array) Main causes only (max 4)  
   * `"treatments"`: (array) Primary treatment options (max 4)
   * `"prevention"`: (string) Brief prevention advice (1-2 sentences)
   * `"when_to_seek_help"`: (string) When to see a doctor (2-3 sentences)
   * `"important_notes"`: (string) Essential disclaimer about consulting professionals
   * `"verified_sources"`: (array) MANDATORY - Include at least 4 sources from the verified list:
     * `"name"`: Official source name from verified list
     * `"url"`: Exact URL from verified list
     * `"category"`: "Government|Database|Portal"
     * `"credibility"`: Why this source is trustworthy

**CRITICAL REQUIREMENTS:**
- Keep responses SHORT and focused
- ALWAYS include the "verified_sources" array - this is mandatory
- Always include disclaimer about consulting healthcare professionals
- Include at least 4 verified sources in every response
"""

# Page scanner prompt template
PROMPT_TEMPLATE_SCANNER = """
You are HealthGuard AI. Scan the following text and extract ALL health-related claims for fact-checking.

Text to analyze:
{text}

**VERIFIED MEDICAL SOURCES - ALWAYS INCLUDE:**
• World Health Organization (WHO) – https://www.who.int
• Centers for Disease Control and Prevention (CDC) – https://www.cdc.gov
• National Institutes of Health (NIH) – https://www.nih.gov
• Mayo Clinic – https://www.mayoclinic.org
• MedlinePlus – https://medlineplus.gov

**Instructions:**
1. Find ALL health-related claims in the text
2. Classify each claim as: "Accurate", "Misleading", or "Unverifiable"
3. ALWAYS include sources in your response

**Response Format:**
```json
{{
  "claims": [
    {{
      "claim_text": "exact claim from text",
      "classification": "Accurate|Misleading|Unverifiable",
      "confidence_score": number,
      "explanation": "why this classification was chosen",
      "correct_information": "what should be correct"
    }}
  ],
  "sources": [
    {{
      "name": "World Health Organization (WHO)",
      "url": "https://www.who.int"
    }},
    {{
      "name": "Centers for Disease Control and Prevention (CDC)",
      "url": "https://www.cdc.gov"
    }},
    {{
      "name": "Mayo Clinic",
      "url": "https://www.mayoclinic.org"
    }}
  ]
}}
```
"""

@app.route("/analyze-multiple", methods=["POST"])
def analyze_multiple():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                "error": "No JSON data provided",
                "is_health_related": False
            }), 400
        
        input_type = data.get("type", "text")
        
        logger.info(f"Processing {input_type} multiple claims analysis request")
        
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
            prompt = PROMPT_TEMPLATE.format(type=input_type, content=prompt_content_for_template[:15000])
            
            response = model.generate_content([prompt, image_part])

        else:  # Handles 'text' and 'link'
            content = data.get("content", "").strip()
            if not content:
                return jsonify({
                    "error": "No content provided", 
                    "is_health_related": False
                }), 400
            
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
            
            # Ensure sources are included - if missing, add default sources
            if "sources" not in output or not output["sources"]:
                output["sources"] = [
                    {"name": "World Health Organization (WHO)", "url": "https://www.who.int"},
                    {"name": "Centers for Disease Control and Prevention (CDC)", "url": "https://www.cdc.gov"},
                    {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org"},
                    {"name": "National Institutes of Health (NIH)", "url": "https://www.nih.gov"},
                    {"name": "MedlinePlus", "url": "https://medlineplus.gov"}
                ]
            
            # Calculate overall statistics if not provided
            if "claims" in output and len(output["claims"]) > 0:
                claims = output["claims"]
                total = len(claims)
                accurate = sum(1 for c in claims if c.get("classification") == "Accurate")
                misleading = sum(1 for c in claims if c.get("classification") == "Misleading") 
                unverifiable = sum(1 for c in claims if c.get("classification") == "Unverifiable")
                
                output.update({
                    "total_claims": total,
                    "accurate_count": accurate,
                    "misleading_count": misleading,
                    "unverifiable_count": unverifiable,
                    "overall_accuracy_percentage": round((accurate / total) * 100) if total > 0 else 0
                })
                
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            logger.error(f"Raw response: {response_text}")
            return jsonify({
                "is_health_related": False,
                "error": "JSON parsing failed",
                "message": f"Could not process AI response. Raw response: {response_text[:200]}..."
            }), 500
        
        logger.info(f"Multiple claims analysis complete: {output.get('total_claims', 0)} claims found")
        return jsonify(output)
        
    except Exception as e:
        logger.error(f"Multiple claims analysis error: {str(e)}")
        return jsonify({
            "error": str(e),
            "is_health_related": False,
            "message": f"An unexpected error occurred: {str(e)}"
        }), 500

@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "HealthGuard API is running",
        "version": "3.1",
        "endpoints": {
            "/validate": "POST - Validate a single health claim (text, link, or image)",
            "/doctor-mode": "POST - Advanced medical consultation mode",
            "/analyze-multiple": "POST - Analyze multiple health claims",
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
            prompt = PROMPT_TEMPLATE.format(type=input_type, content=prompt_content_for_template[:15000])
            
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
            
            # Ensure sources are always included
            if "sources" not in output or not output["sources"]:
                output["sources"] = [
                    {"name": "World Health Organization (WHO)", "url": "https://www.who.int"},
                    {"name": "Centers for Disease Control and Prevention (CDC)", "url": "https://www.cdc.gov"},
                    {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org"},
                    {"name": "National Institutes of Health (NIH)", "url": "https://www.nih.gov"},
                    {"name": "MedlinePlus", "url": "https://medlineplus.gov"}
                ]
                
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            logger.error(f"Raw response: {response_text}")
            return jsonify({
                "classification": "Unverifiable",
                "summary": "Could not process AI response.",
                "explanation": f"The response from the AI was not in a valid format. Raw response: {response_text[:200]}...",
                "sources": [
                    {"name": "World Health Organization (WHO)", "url": "https://www.who.int"},
                    {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org"}
                ],
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
            "sources": [
                {"name": "World Health Organization (WHO)", "url": "https://www.who.int"},
                {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org"}
            ]
        }), 500

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
            
            prompt_content_for_template = text_content if text_content else "Analyze the attached image."
            prompt = DOCTOR_MODE_PROMPT.format(type=input_type, content=prompt_content_for_template[:15000])
            
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
            
            # Ensure verified_sources are always included
            if "verified_sources" not in output or not output["verified_sources"]:
                output["verified_sources"] = [
                    {"name": "World Health Organization (WHO)", "url": "https://www.who.int", "category": "Government", "credibility": "Global health authority"},
                    {"name": "Centers for Disease Control and Prevention (CDC)", "url": "https://www.cdc.gov", "category": "Government", "credibility": "US national public health institute"},
                    {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org", "category": "Portal", "credibility": "Leading medical research institution"},
                    {"name": "National Institutes of Health (NIH)", "url": "https://www.nih.gov", "category": "Government", "credibility": "Primary US medical research agency"}
                ]
                
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error in doctor mode: {e}")
            logger.error(f"Raw response: {response_text}")
            return jsonify({
                "response_type": "error",
                "detailed_explanation": f"Could not process AI response. Raw response: {response_text[:200]}...",
                "error": "JSON parsing failed",
                "verified_sources": [
                    {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org", "category": "Portal", "credibility": "Leading medical research institution"}
                ]
            }), 500
        
        logger.info(f"Doctor mode consultation complete: {output.get('response_type', 'Unknown')}")
        return jsonify(output)
        
    except Exception as e:
        logger.error(f"Doctor mode error: {str(e)}")
        return jsonify({
            "error": str(e),
            "response_type": "error",
            "detailed_explanation": f"An unexpected error occurred: {str(e)}",
            "verified_sources": [
                {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org", "category": "Portal", "credibility": "Leading medical research institution"}
            ]
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
            return jsonify({
                "claims": [], 
                "statistics": calculate_statistics([]),
                "sources": [
                    {"name": "World Health Organization (WHO)", "url": "https://www.who.int"},
                    {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org"}
                ]
            }), 200

        # Clean up the response text
        response_text = clean_response_text(response.text)
        logger.info(f"Cleaned response text: {response_text[:200]}...")

        try:
            output = json.loads(response_text)
            if "claims" not in output:
                logger.warning("Response missing 'claims' key, creating empty claims array")
                output = {"claims": []}
                
            # Ensure sources are always included
            if "sources" not in output or not output["sources"]:
                output["sources"] = [
                    {"name": "World Health Organization (WHO)", "url": "https://www.who.int"},
                    {"name": "Centers for Disease Control and Prevention (CDC)", "url": "https://www.cdc.gov"},
                    {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org"},
                    {"name": "National Institutes of Health (NIH)", "url": "https://www.nih.gov"},
                    {"name": "MedlinePlus", "url": "https://medlineplus.gov"}
                ]
                
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error during page scan: {e}")
            logger.error(f"Raw response: {response_text[:500]}...")
            # Fallback with default sources
            output = {
                "claims": [],
                "sources": [
                    {"name": "World Health Organization (WHO)", "url": "https://www.who.int"},
                    {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org"}
                ]
            }

        # Calculate statistics
        claims = output.get('claims', [])
        statistics = calculate_statistics(claims)
        
        # Add statistics to output
        output["statistics"] = statistics
        
        claims_count = len(claims)
        logger.info(f"Page scan complete. Found {claims_count} claims.")
        logger.info(f"Statistics: {statistics['accurate_percentage']}% accurate, {statistics['misleading_percentage']}% misleading, {statistics['unverifiable_percentage']}% unverifiable")
        
        # Log each claim for debugging
        for i, claim in enumerate(claims):
            logger.info(f"Claim {i+1}: {claim.get('claim_text', 'N/A')[:100]}... - {claim.get('classification', 'N/A')}")
        
        return jsonify(output)

    except Exception as e:
        logger.error(f"Page scan error: {str(e)}")
        return jsonify({
            "error": str(e), 
            "claims": [], 
            "statistics": calculate_statistics([]),
            "sources": [
                {"name": "World Health Organization (WHO)", "url": "https://www.who.int"},
                {"name": "Mayo Clinic", "url": "https://www.mayoclinic.org"}
            ]
        }), 500

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