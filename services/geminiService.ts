import { GoogleGenAI, Content, Part } from "@google/genai";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

// Using the specific model version requested in the original code
const MODEL_NAME = 'gemini-2.5-flash-preview-09-2025';

export const generateMarketAnalysis = async (promptText: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: promptText,
    });
    return response.text || "無法生成分析結果。";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};

export const generateChatResponse = async (history: { role: 'user' | 'model'; text: string }[], newMessage: string): Promise<string> => {
  try {
    // Convert custom history format to Gemini API Content format
    const contents: Content[] = history.map(msg => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text } as Part]
    }));

    // Add the new message
    contents.push({
      role: 'user',
      parts: [{ text: newMessage } as Part]
    });

    // Add a system-like instruction at the beginning of the first user message if possible,
    // or just prepend it to the first message part.
    const systemPrompt = "你是一個專業的房地產數據助手。請根據目前的實價登錄資料回答問題。";
    
    if (contents.length > 0 && contents[0].parts && contents[0].parts.length > 0) {
       const firstPart = contents[0].parts[0];
       if ('text' in firstPart) {
           firstPart.text = `${systemPrompt}\n\n${firstPart.text}`;
       }
    }

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: contents,
    });

    return response.text || "抱歉，我無法回答這個問題。";
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    throw error;
  }
};
