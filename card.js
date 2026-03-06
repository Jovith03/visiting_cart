const express = require("express");
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Pool } = require("pg");
const sharp = require("sharp");
const fs = require("fs");

const app = express();
const upload = multer({ dest: "uploads/" });

// ---------------- 1. POSTGRESQL CONNECTION ----------------
const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "postgres",
    password: "qwerty",
    port: 5432,
});

// ---------------- 2. AI LAYER: IMAGE COMPRESSION ----------------
// Ensures the image is reduced to under 1MB as per the flow diagram
async function compressImageToBuffer(inputPath) {
    let quality = 80;
    let buffer = await sharp(inputPath).jpeg({ quality }).toBuffer();

    // Loop until size < 1MB (1,048,576 bytes)
    while (buffer.length > 1048576 && quality > 5) {
        quality -= 10;
        buffer = await sharp(inputPath).jpeg({ quality }).toBuffer();
    }
    return buffer.toString("base64");
}

// ---------------- 3. USER INTERFACE (UI) ----------------
app.get("/", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Visiting Card Scanner</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        :root {
            --primary: #6366f1;
            --primary-hover: #4f46e5;
            --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            --card-bg: rgba(255, 255, 255, 0.05);
            --border: rgba(255, 255, 255, 0.1);
            --text: #f8fafc;
        }
        body {
            font-family: 'Inter', sans-serif;
            background: var(--bg-gradient);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 20px;
        }
        .container {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            text-align: center;
            animation: fadeIn 0.6s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        h2 {
            margin-top: 0;
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
            background: linear-gradient(to right, #a855f7, #3b82f6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p {
            color: #94a3b8;
            margin-bottom: 30px;
            line-height: 1.5;
        }
        .upload-area {
            border: 2px dashed var(--border);
            border-radius: 16px;
            padding: 40px 20px;
            margin-bottom: 24px;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
        }
        .upload-area:hover {
            border-color: var(--primary);
            background: rgba(99, 102, 241, 0.05);
        }
        .upload-icon {
            font-size: 40px;
            margin-bottom: 12px;
            display: block;
        }
        input[type="file"] {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            cursor: pointer;
        }
        button {
            background: var(--primary);
            color: white;
            border: none;
            padding: 14px 28px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            transition: all 0.2s ease;
            box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.4);
        }
        button:hover {
            background: var(--primary-hover);
            transform: translateY(-2px);
            box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.5);
        }
        .links {
            margin-top: 24px;
        }
        a {
            color: #a855f7;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.2s;
        }
        a:hover {
            color: #c084fc;
        }
        .file-name {
            display: none;
            margin-top: 15px;
            color: #38bdf8;
            font-size: 14px;
            font-weight: 500;
        }
    </style>
</head>
<body>
    <div class="container">
        <h2>AI Visiting Card Scanner</h2>
        <p>Extract Names, Phone Numbers, and Addresses instantly using AI and OCR.</p>
        
        <form action="/upload" method="POST" enctype="multipart/form-data">
            <div class="upload-area">
                <span class="upload-icon">📄</span>
                <span style="display:block; font-weight: 500;">Drag & drop your card image</span>
                <span style="color: #64748b; font-size: 13px; margin-top: 8px; display:block;">or click to browse files</span>
                <input type="file" name="card" accept="image/*" required id="fileInput" onchange="document.getElementById('fileName').style.display='block'; document.getElementById('fileName').innerText = 'Selected: ' + this.files[0].name;" />
                <div id="fileName" class="file-name"></div>
            </div>
            
            <button type="submit">Extract Data with AI</button>
        </form>
        
        <div class="links">
            <a href="/results">Browse Database Results &rarr;</a>
        </div>
    </div>
</body>
</html>
    `);
});

// --- GEMINI SETUP ---
// Get your API Key from https://aistudio.google.com/
const GEMINI_API_KEY = "AIzaSyAIgsUk_Mwvs74zxPWXbWnXtBh1YNe9fRc";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ---------------- 4. MAIN API: AI PROCESSING FLOW ----------------
app.post("/upload", upload.single("card"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No image provided" });

    const client = await pool.connect();
    const originalImagePath = req.file.path;

    try {
        await client.query("BEGIN");

        // --- STEP: AI Layer Init & JobID Provided ---
        const originalBase64 = fs.readFileSync(originalImagePath).toString("base64");
        const jobRes = await client.query(
            `INSERT INTO AI_Jobs (imageBase64, Request) VALUES ($1, $2) RETURNING JobID`,
            [originalBase64, "Gemini Vision Request"]
        );
        const jobId = jobRes.rows[0].jobid;

        // --- STEP: Image Compression (To 1MB) ---
        const compressedBase64 = await compressImageToBuffer(originalImagePath);

        // --- STEP: Gemini Vision OCR ---
        console.log("--- Gemini AI Processing Started ---");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
            Extract the Business Name/Store Name, Phone Number, and Address from this visiting card.
            The image might be a mockup on a wooden background or have background text like 'CorelDraw' - IGNORE all background text and design labels.
            Focus ONLY on the information written ON the card itself.
            Return the result in THIS JSON format:
            {
                "name": "Store/Person Name",
                "phone": "Phone Number",
                "address": "Full Address"
            }
            ONLY return the JSON, nothing else.
        `;

        const imageParts = [
            {
                inlineData: {
                    data: originalBase64,
                    mimeType: req.file.mimetype
                }
            }
        ];

        const result = await model.generateContent([prompt, ...imageParts]);
        const responseText = await result.response.text();

        // Clean and Parse JSON from Gemini
        let extracted = { name: "Unknown", phone: "N/A", address: "Not found" };
        try {
            const jsonStr = responseText.replace(/```json|```/g, "").trim();
            extracted = JSON.parse(jsonStr);
        } catch (e) {
            console.error("Gemini JSON Parse Error. Raw Response:", responseText);
        }

        console.log("Gemini Extracted Data:", extracted);

        // --- STEP: Database Storage ---
        await client.query(
            `INSERT INTO Customer_Data 
            ("Phn No (i18n)", Name, Address, Product_Notes, photo_binary, BusinessType, JobID) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                extracted.phone || "N/A",
                extracted.name || "Unknown",
                extracted.address || "Not found",
                "Gemini AI Vision Extraction",
                compressedBase64,
                "Professional",
                jobId
            ]
        );

        await client.query("COMMIT");
        fs.unlinkSync(originalImagePath);

        res.status(200).json({
            message: "Success",
            jobId: jobId,
            extracted: extracted
        });

    } catch (err) {
        if (client) await client.query("ROLLBACK");
        console.error("Gemini Error:", err);
        res.status(500).json({ error: "AI Processing Failed", details: err.message });
    } finally {
        if (client) client.release();
    }
});

// ---------------- 4. VIEW RESULTS ----------------
app.get("/results", async (req, res) => {
    const result = await pool.query(`
        SELECT j.JobID, c.Name, c."Phn No (i18n)", c.Address 
        FROM AI_Jobs j 
        JOIN Customer_Data c ON j.JobID = c.JobID 
        ORDER BY j.JobID DESC
    `);
    res.json(result.rows);
});

app.listen(3000, () => {
    console.log("Server active at http://localhost:3000");
});
