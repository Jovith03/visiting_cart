const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");
const sharp = require("sharp");
const fs = require("fs");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
const upload = multer({ dest: "uploads/" });

// 🔥 Gemini Config
const genAI = new GoogleGenerativeAI("AIzaSyD89z5xNvdn1jlU1fR_nCUPoSK1KMVrtSA");

// DB Config same as yours
const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "postgres",
    password: "password",
    port: 5432,
});

// ---------------- DB INITIALIZATION ----------------
const initDB = async () => {
    try {
        const client = await pool.connect();
        await client.query(`
            CREATE TABLE IF NOT EXISTS AI_Jobs (
                JobID SERIAL PRIMARY KEY,
                imageBase64 TEXT,
                raw_text TEXT,
                status TEXT DEFAULT 'Pending',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS Customer_Data (
                CUST_ID SERIAL PRIMARY KEY,
                name TEXT,
                phone TEXT,
                email TEXT,
                address TEXT,
                home_address TEXT,
                website TEXT,
                JobID INTEGER REFERENCES AI_Jobs(JobID),
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Database Tables Verified/Created");
        client.release();
    } catch (err) {
        console.error("Error initializing database:", err.message);
    }
};

initDB();

// Skipping model check on startup to avoid noise
const listModels = () => console.log("AI Ready (will try models on request)");
listModels();

const modelsToTry = ["gemini-1.5-flash", "gemini-1.5-flash-latest"];

app.post("/upload", upload.single("card"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    const imagePath = req.file.path;
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString("base64");

        const jobResult = await client.query(
            "INSERT INTO AI_Jobs (imageBase64) VALUES ($1) RETURNING JobID",
            [base64Image]
        );

        const jobId = jobResult.rows[0].jobid;
        const compressedPath = `uploads/compressed_${jobId}.jpg`;
        await sharp(imagePath)
            .resize({ width: 1200 })
            .jpeg({ quality: 90 })
            .toFile(compressedPath);

        const finalImageBuffer = fs.readFileSync(compressedPath);
        const prompt = `
            Read this business card image and extract the information.
            Format it clearly as:
            Name:
            Phone:
            Email:
            Company:
            Address:
            Website:

            Return only the extracted text.
            If a field is not found, write "Not Found".
        `;

        let aiText = "";
        let success = false;
        let lastError = "";

        // Updated list of supported models from your actual API key
        const modelsToTry = [
            "gemini-2.0-flash",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.5-pro",
            "gemini-2.0-flash-lite",
            "gemini-1.5-flash",
            "gemini-2.0-flash-exp"
        ];

        for (const modelName of modelsToTry) {
            try {
                console.log(`AI Task: Trying model ${modelName}...`);
                const currentModel = genAI.getGenerativeModel({ model: modelName });

                // Gemini wants the image parts first usually
                const result = await currentModel.generateContent([
                    {
                        inlineData: {
                            data: finalImageBuffer.toString("base64"),
                            mimeType: "image/jpeg",
                        },
                    },
                    { text: prompt },
                ]);

                const response = await result.response;
                aiText = response.text();

                if (aiText) {
                    success = true;
                    console.log(`AI Success with ${modelName}`);
                    break;
                }
            } catch (err) {
                console.error(`AI Failure with ${modelName}:`, err.message);
                lastError = err.message;
                continue;
            }
        }

        if (!success) {
            throw new Error(`AI processing failed after trying multiple models. Last error: ${lastError}`);
        }

        await client.query(
            "UPDATE AI_Jobs SET raw_text=$1, status='Completed' WHERE JobID=$2",
            [aiText, jobId]
        );

        await client.query("COMMIT");

        fs.unlinkSync(imagePath);
        fs.unlinkSync(compressedPath);

        res.json({
            message: "AI Processing Completed",
            JobID: jobId,
            extracted_text: aiText
        });

    } catch (error) {
        if (client) await client.query("ROLLBACK");
        console.error("❌ Final Error:", error); // Log the whole error object for stack trace
        res.status(500).json({
            error: "Processing Failed",
            details: error.message
        });
    } finally {
        client.release();
    }
});

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/visiting-card.html");
});

app.listen(3000, () => {
    console.log("Server running at http://localhost:3000");
});