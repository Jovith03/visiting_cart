const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI("AIzaSyD89z5xNvdn1jlU1fR_nCUPoSK1KMVrtSA");

async function listAllModels() {
    const models = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-1.5-pro", "gemini-pro-vision"];
    for (const m of models) {
        try {
            const model = genAI.getGenerativeModel({ model: m });
            await model.generateContent("test");
            console.log(`MODEL ${m}: SUCCESS`);
        } catch (e) {
            console.log(`MODEL ${m}: FAIL - ${e.message}`);
        }
    }
}

listAllModels();
