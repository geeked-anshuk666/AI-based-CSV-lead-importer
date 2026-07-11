import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const ALLOWED_CRM_STATUSES = ['GOOD_LEAD_FOLLOW_UP', 'DID_NOT_CONNECT', 'BAD_LEAD', 'SALE_DONE'];
const ALLOWED_DATA_SOURCES = ['leads_on_demand', 'meridian_tower', 'eden_park', 'varah_swamy', 'sarjapur_plots'];

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

  public static async mapLeadsBatch(
    rawRows: any[],
    onModelAttempt?: (modelName: string, status: 'attempt' | 'success' | 'failure', errorMsg?: string) => void,
    preferredModel?: string
  ): Promise<{ leads: any[]; modelUsed: string }> {
    const localModelName = 'GrowEasy Local Rule-Based Mapper';
    if (preferredModel === localModelName) {
      if (onModelAttempt) onModelAttempt(localModelName, 'attempt');
      const leads = this.mapLeadsLocally(rawRows);
      if (onModelAttempt) onModelAttempt(localModelName, 'success');
      return { leads, modelUsed: localModelName };
    }

    const prompt = this.buildPrompt(rawRows);

    if (this.geminiKey && (!preferredModel || preferredModel === 'google/gemini-2.5-flash')) {
      const modelName = 'google/gemini-2.5-flash';
      if (onModelAttempt) onModelAttempt(modelName, 'attempt');
      try {
        console.log(`Attempting AI mapping via Google Gemini API...`);
        const leads = await this.callGemini(prompt);
        if (onModelAttempt) onModelAttempt(modelName, 'success');
        return { leads, modelUsed: modelName };
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        console.warn('Gemini API call failed, falling back to OpenRouter...', errMsg);
        if (onModelAttempt) onModelAttempt(modelName, 'failure', errMsg);
      }
    }

    if (this.openrouterKey) {
      let modelsToTry = OPENROUTER_MODELS;
      if (preferredModel && OPENROUTER_MODELS.includes(preferredModel)) {
        const idx = OPENROUTER_MODELS.indexOf(preferredModel);
        modelsToTry = OPENROUTER_MODELS.slice(idx);
      }

      for (const model of modelsToTry) {
        if (onModelAttempt) onModelAttempt(model, 'attempt');
        try {
          console.log(`Attempting AI mapping via OpenRouter model: ${model}...`);
          const leads = await this.callOpenRouter(prompt, model);
          if (onModelAttempt) onModelAttempt(model, 'success');
          return { leads, modelUsed: model };
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          console.warn(`OpenRouter model ${model} failed. Trying next fallback...`, errMsg);
          if (onModelAttempt) onModelAttempt(model, 'failure', errMsg);
          if (errMsg.includes('429')) {
            await new Promise(r => setTimeout(r, 4000));
          }
        }
      }
    }

    if (onModelAttempt) onModelAttempt(localModelName, 'attempt');
    console.warn('All AI models exhausted. Falling back to local rule-based mapper.');
    const leads = this.mapLeadsLocally(rawRows);
    if (onModelAttempt) onModelAttempt(localModelName, 'success');
    return { leads, modelUsed: localModelName };
  }

  private static mapLeadsLocally(rawRows: any[]): any[] {
    const mapped: any[] = [];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (const row of rawRows) {
      const findVal = (patterns: string[]): string | null => {
        for (const pattern of patterns) {
          const key = Object.keys(row).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes(pattern));
          if (key && row[key]) return String(row[key]).trim();
        }
        return null;
      };

      let email = findVal(['email', 'mail']);
      const phone = findVal(['phone', 'mobile', 'num', 'contact']);

      if (email && !emailRegex.test(email)) {
        email = null;
      }

      const leftoverNotes: string[] = [];
      for (const [key, val] of Object.entries(row)) {
        const lowerKey = key.toLowerCase();
        if (
          !lowerKey.includes('name') &&
          !lowerKey.includes('email') &&
          !lowerKey.includes('phone') &&
          !lowerKey.includes('mobile') &&
          !lowerKey.includes('city') &&
          !lowerKey.includes('state') &&
          !lowerKey.includes('country') &&
          !lowerKey.includes('company')
        ) {
          leftoverNotes.push(`${key}: ${val}`);
        }
      }

      let countryCode = '+91';
      let cleanPhone = phone || '';
      if (cleanPhone.startsWith('+')) {
        const parts = cleanPhone.split(/\s+/);
        if (parts[0] && parts[0].length <= 4) {
          countryCode = parts[0];
          cleanPhone = parts.slice(1).join('');
        }
      }
      cleanPhone = cleanPhone.replace(/[^0-9]/g, '');

      if (!email && cleanPhone.length < 6) {
        continue;
      }

      let crmStatus = 'GOOD_LEAD_FOLLOW_UP';
      const rawStatus = findVal(['status', 'stage']);
      if (rawStatus) {
        const norm = rawStatus.toUpperCase().replace(/[^A-Z]/g, '');
        if (norm.includes('SALE') || norm.includes('DONE')) crmStatus = 'SALE_DONE';
        else if (norm.includes('BAD') || norm.includes('JUNK')) crmStatus = 'BAD_LEAD';
        else if (norm.includes('NOTCONNECT') || norm.includes('NOANSWER')) crmStatus = 'DID_NOT_CONNECT';
      }

      let dataSource = 'leads_on_demand';
      const rawSource = findVal(['source']);
      if (rawSource) {
        const norm = rawSource.toLowerCase();
        for (const ds of ALLOWED_DATA_SOURCES) {
          if (norm.includes(ds.replace(/_/g, '')) || ds.replace(/_/g, '').includes(norm)) {
            dataSource = ds;
            break;
          }
        }
      }

      mapped.push({
        name: findVal(['name', 'firstname', 'lastname', 'owner', 'contactperson']) || 'Unknown Lead',
        email: email,
        country_code: countryCode,
        mobile_without_country_code: cleanPhone || null,
        company: findVal(['company', 'firm', 'org']),
        city: findVal(['city', 'town']),
        state: findVal(['state', 'region']),
        country: findVal(['country']) || 'India',
        lead_owner: findVal(['owner', 'assignee']) || 'agent@groweasy.ai',
        crm_status: crmStatus,
        crm_note: leftoverNotes.join('; ').substring(0, 1000),
        data_source: dataSource,
        possession_time: findVal(['possession', 'time']),
        description: findVal(['description', 'remarks', 'note']),
        created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
      });
    }

    return mapped;
  }

  private static async callGemini(prompt: string): Promise<any[]> {
    const ai = new GoogleGenerativeAI(this.geminiKey);
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('Google Gemini API request timed out after 8s')), 8000)
      )
    ]);

    const text = result.response.text();
    return this.parseJsonResponse(text);
  }

  private static async callOpenRouter(prompt: string, model: string): Promise<any[]> {
    let response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (response.status === 400) {
      console.warn(`Model ${model} rejected json_object format. Retrying in text mode...`);
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://groweasy.ai',
          'X-Title': 'GrowEasy CSV Importer'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: AbortSignal.timeout(8000)
      });
    }

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
    let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /[0-9]{6,}/;

    const sanitizeLeadsList = (leads: any[]): any[] => {
      if (!Array.isArray(leads)) return [];
      return leads
        .map(lead => {
          let email = lead.email ? String(lead.email).trim() : null;
          let phone = lead.mobile_without_country_code ? String(lead.mobile_without_country_code).replace(/[^0-9]/g, '') : null;

          if (email && !emailRegex.test(email)) {
            email = null;
          }
          if (phone && !phoneRegex.test(phone)) {
            phone = null;
          }

          return {
            ...lead,
            email,
            mobile_without_country_code: phone
          };
        })
        .filter(lead => lead.email || lead.mobile_without_country_code);
    };

    try {
      const parsed = JSON.parse(cleanText);
      if (parsed && Array.isArray(parsed.leads)) {
        return sanitizeLeadsList(parsed.leads);
      }
    } catch (err) {
      console.warn('Standard JSON parse failed. Attempting regex extraction...', err);
    }

    const arrayMatch = cleanText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      try {
        const parsedArray = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsedArray)) {
          return sanitizeLeadsList(parsedArray);
        }
      } catch (e) {
        console.error('Regex extraction JSON parse failed:', e);
      }
    }

    throw new Error('Invalid response structure from AI model');
  }
}
