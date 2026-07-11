import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

// Allowed CRM Statuses & Data Sources
const ALLOWED_CRM_STATUSES = ['GOOD_LEAD_FOLLOW_UP', 'DID_NOT_CONNECT', 'BAD_LEAD', 'SALE_DONE'];
const ALLOWED_DATA_SOURCES = ['leads_on_demand', 'meridian_tower', 'eden_park', 'varah_swamy', 'sarjapur_plots'];

// Cascade of fallback models on OpenRouter
const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'nousresearch/hermes-3-405b:free',
  'google/gemma-2-9b-it:free',
  'openrouter/auto'
];

export class AiService {
  private static geminiKey = process.env.GEMINI_API_KEY || '';
  private static openrouterKey = process.env.OPENROUTER_API_KEY || '';

  /**
   * Intelligently maps a batch of raw CSV rows to GrowEasy CRM Lead format.
   */
  public static async mapLeadsBatch(rawRows: any[]): Promise<any[]> {
    const prompt = this.buildPrompt(rawRows);

    // Try Google Gemini directly first
    if (this.geminiKey) {
      try {
        console.log('Attempting AI mapping via Google Gemini API...');
        return await this.callGemini(prompt);
      } catch (err) {
        console.warn('Gemini API call failed, falling back to OpenRouter...', err);
      }
    }

    // Fallback to OpenRouter cascading model list
    if (this.openrouterKey) {
      for (const model of OPENROUTER_MODELS) {
        try {
          console.log(`Attempting AI mapping via OpenRouter model: ${model}...`);
          return await this.callOpenRouter(prompt, model);
        } catch (err) {
          console.warn(`OpenRouter model ${model} failed. Trying next fallback...`, err);
        }
      }
    }

    throw new Error('All AI Mapping services exhausted or unavailable.');
  }

  private static async callGemini(prompt: string): Promise<any[]> {
    const ai = new GoogleGenerativeAI(this.geminiKey);
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return this.parseJsonResponse(text);
  }


  private static async callOpenRouter(prompt: string, model: string): Promise<any[]> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://groweasy.ai',
        'X-Title': 'GrowEasy CSV Importer'
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: Status ${response.status}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenRouter');
    }

    return this.parseJsonResponse(content);
  }

  private static buildPrompt(rawRows: any[]): string {
    return `
You are an expert CRM data mapping engine.
Your task is to map a batch of raw CSV records to the GrowEasy CRM lead format.

### Target GrowEasy CRM Schema:
Map fields to this exact structure:
- name: Lead's full name.
- email: Primary email address. If multiple email addresses are present, put the first email here, and append the rest to crm_note.
- country_code: Phone country code (e.g. +91, +1).
- mobile_without_country_code: Mobile number without country code. If multiple numbers exist, put the first here, and append the rest to crm_note.
- company: Company name.
- city: City.
- state: State.
- country: Country.
- lead_owner: Email of the lead owner.
- crm_status: Current status. MUST be exactly one of: [${ALLOWED_CRM_STATUSES.join(', ')}]. If cannot map, default to GOOD_LEAD_FOLLOW_UP.
- crm_note: Any remarks, extra phone numbers, extra email addresses, or unmatched fields.
- data_source: Source of the lead. MUST be exactly one of: [${ALLOWED_DATA_SOURCES.join(', ')}]. If none match, leave it blank or null.
- possession_time: Estimated property possession time.
- description: Additional details.
- created_at: Date of creation. Format as "YYYY-MM-DD HH:mm:ss" which is valid for new Date() parsing in JS.

### Rules:
1. Return a JSON object with a single key "leads" which contains an array of mapped lead objects.
2. If a record contains neither a valid email nor a valid mobile number, exclude (skip) it from the returned array.
3. Output ONLY valid JSON. Do not include markdown code block formats (e.g. \`\`\`json) in your raw response.

Here is the raw input JSON batch of CSV records:
${JSON.stringify(rawRows, null, 2)}
`;
  }

  private static parseJsonResponse(text: string): any[] {
    // Strip markdown formatting if the model ignored instructions
    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanText);
    if (!parsed || !Array.isArray(parsed.leads)) {
      throw new Error('Invalid response structure from AI model');
    }
    return parsed.leads;
  }
}
