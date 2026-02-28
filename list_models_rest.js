const { GoogleGenerativeAI } = require("@google/generative-ai");

// Use the API key from your config
const genAI = new GoogleGenerativeAI("AIzaSyD89z5xNvdn1jlU1fR_nCUPoSK1KMVrtSA");

async function listSupportedModels() {
    try {
        console.log("--- Fetching Supported Models ---");
        // Using the v1 stable version if the SDK allows or just testing standard names
        // Note: The Node SDK usually uses v1beta by default unless configured otherwise

        // This is the direct REST approach to see what your key can actually see
        const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

        const response = await (await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${genAI.apiKey}`)).json();

        if (response.models) {
            console.log("Available Models:");
            response.models.forEach(m => {
                console.log(`- ${m.name} (Supports: ${m.supportedGenerationMethods.join(", ")})`);
            });
        } else {
            console.log("No models returned. Response:", JSON.stringify(response));
        }
    } catch (err) {
        console.error("Error listing models:", err.message);
    }
}

listSupportedModels();
