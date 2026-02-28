const express = require("express");
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Pool } = require("pg");
const sharp = require("sharp");
const fs = require("fs");
const Tesseract = require("tesseract.js"); // Added for fallback OCR

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
    <title>AI Cardio - Premium Card Scanner</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
        
        :root {
            --primary: #8b5cf6;
            --secondary: #ec4899;
            --accent: #06b6d4;
            --bg: #0f172a;
            --glass: rgba(255, 255, 255, 0.03);
            --border: rgba(255, 255, 255, 0.08);
            --text: #f8fafc;
        }

        * { box-sizing: border-box; }
        body {
            font-family: 'Outfit', sans-serif;
            background: radial-gradient(circle at top right, #1e1b4b, #0f172a);
            color: var(--text);
            min-height: 100vh;
            margin: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            overflow-x: hidden;
        }

        .navbar {
            padding: 24px 40px;
            width: 100%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
            background: rgba(15, 23, 42, 0.8);
            backdrop-filter: blur(10px);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .logo {
            font-size: 24px;
            font-weight: 700;
            background: linear-gradient(to right, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .container {
            max-width: 1000px;
            width: 90%;
            margin: 60px auto;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
            animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(40px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .hero-section {
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        h1 {
            font-size: 48px;
            font-weight: 700;
            margin: 0 0 20px 0;
            line-height: 1.1;
        }

        .scanner-card {
            background: var(--glass);
            border: 1px solid var(--border);
            border-radius: 32px;
            padding: 40px;
            backdrop-filter: blur(20px);
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        }

        .upload-area {
            border: 2px dashed var(--border);
            border-radius: 20px;
            padding: 60px 40px;
            text-align: center;
            transition: all 0.4s ease;
            position: relative;
            background: rgba(255,255,255,0.01);
        }

        .upload-area:hover {
            border-color: var(--primary);
            background: rgba(139, 92, 246, 0.05);
            transform: scale(1.02);
        }

        .result-panel {
            display: none;
            margin-top: 30px;
            padding: 24px;
            background: rgba(0,0,0,0.2);
            border-radius: 20px;
            border: 1px solid var(--primary);
            animation: fadeIn 0.5s ease;
        }

        .data-item {
            margin-bottom: 20px;
        }
        .data-label {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #64748b;
            margin-bottom: 4px;
        }
        .data-value {
            font-size: 18px;
            font-weight: 500;
            color: #e2e8f0;
        }

        button {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
            border: none;
            padding: 16px 32px;
            border-radius: 16px;
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            margin-top: 24px;
            transition: all 0.3s ease;
        }

        button:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px -5px rgba(139, 92, 246, 0.5);
        }

        button:disabled { opacity: 0.5; cursor: not-allowed; }

        .loader {
            display: none;
            width: 24px;
            height: 24px;
            border: 3px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        @media (max-width: 800px) {
            .container { grid-template-columns: 1fr; }
            h1 { font-size: 36px; }
        }

        .nav-links a {
            color: #94a3b8;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.3s;
        }
        .nav-links a:hover { color: white; }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="logo">✨ AI Cardio</div>
        <div class="nav-links">
            <a href="/results">Browse Archive</a>
        </div>
    </nav>

    <div class="container">
        <div class="hero-section">
            <h1>Turn physical cards into <span style="color:var(--accent)">intelligent data</span> instantly.</h1>
            <p style="color: #64748b; font-size: 20px; margin-bottom: 0;">Powered by Gemini 1.5 Flash Vision. Reads any angle, any font, perfectly.</p>
        </div>

        <div class="scanner-card">
            <form id="uploadForm">
                <div class="upload-area" id="dropZone">
                    <div id="uploadContent">
                        <div style="font-size: 48px; margin-bottom: 20px;">📸</div>
                        <div style="font-weight: 600; font-size: 20px;">Upload Card Image</div>
                        <div style="color: #64748b; margin-top: 8px;">Drag & drop or tap to browse</div>
                    </div>
                    <input type="file" name="card" style="position:absolute; inset:0; opacity:0; cursor:pointer;" accept="image/*" required id="fileInput">
                </div>
                
                <button type="submit" id="submitBtn">
                    <span id="btnText">Scan with Intelligence</span>
                    <div class="loader" id="loader"></div>
                </button>
            </form>

            <div id="resultPanel" class="result-panel">
                <div style="color:var(--accent); font-weight:700; margin-bottom:20px; display:flex; align-items:center; gap:8px;">
                    ✅ Analysis Complete
                </div>
                <div class="data-item">
                    <div class="data-label">Business Name</div>
                    <div class="data-value" id="resName"></div>
                </div>
                <div class="data-item">
                    <div class="data-label">Contact Number</div>
                    <div class="data-value" id="resPhone"></div>
                </div>
                <div class="data-item">
                    <div class="data-label">Location Address</div>
                    <div class="data-value" id="resAddr"></div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const form = document.getElementById('uploadForm');
        const fileInput = document.getElementById('fileInput');
        const submitBtn = document.getElementById('submitBtn');
        const loader = document.getElementById('loader');
        const btnText = document.getElementById('btnText');
        const resPanel = document.getElementById('resultPanel');

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                document.getElementById('uploadContent').innerHTML = \`
                    <div style="font-size: 48px; margin-bottom: 20px;">📎</div>
                    <div style="font-weight: 600; color:var(--accent); font-size: 18px;">\${e.target.files[0].name}</div>
                    <div style="color: #64748b; margin-top: 8px;">File ready for analysis</div>
                \`;
            }
        });

        form.onsubmit = async (e) => {
            e.preventDefault();
            
            submitBtn.disabled = true;
            btnText.style.display = 'none';
            loader.style.display = 'block';
            resPanel.style.display = 'none';

            const formData = new FormData(form);
            try {
                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                
                if (data.extracted) {
                    document.getElementById('resName').innerText = data.extracted.name;
                    document.getElementById('resPhone').innerText = data.extracted.phone;
                    document.getElementById('resAddr').innerText = data.extracted.address;
                    resPanel.style.display = 'block';
                    resPanel.scrollIntoView({ behavior: 'smooth' });
                }
            } catch (err) {
                alert('Analysis failed. Please check your connection.');
            } finally {
                submitBtn.disabled = false;
                btnText.style.display = 'block';
                loader.style.display = 'none';
            }
        };
    </script>
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
        // Using gemini-1.5-flash which is robust for vision tasks.
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
            Extract ALL details from this business card. 
            Ignore background textures (wood, design labels).
            Focus only on the card text.
            Return ONLY a JSON object:
            {
                "name": "Full Name",
                "company": "Company Name",
                "title": "Job Title",
                "phone": "Phone Number",
                "email": "Email Address",
                "address": "Physical Address",
                "website": "Website URL"
            }
        `;

        const imageParts = [{
            inlineData: {
                data: compressedBase64, // Use compressed image to stay under limits and save bandwidth
                mimeType: req.file.mimetype
            }
        }];

        let responseText = "";
        try {
            const imageParts = [{
                inlineData: {
                    data: compressedBase64,
                    mimeType: req.file.mimetype
                }
            }];
            const result = await model.generateContent([prompt, ...imageParts]);
            responseText = await result.response.text();
            console.log("Gemini AI Response Received.");
        } catch (aiErr) {
            console.warn("Gemini AI Failed, falling back to Tesseract OCR:", aiErr.message);
            // Fallback: Use Tesseract OCR if Gemini fails
            const ocrResult = await Tesseract.recognize(fs.readFileSync(originalImagePath), 'eng');
            const rawText = ocrResult.data.text;

            // Basic extraction from raw text for fallback
            responseText = JSON.stringify({
                name: (rawText.split('\n')[0] || "Found with OCR").substring(0, 50),
                company: "Extracted via OCR",
                title: "N/A",
                phone: (rawText.match(/[\+\d\-\s]{10,}/) || ["N/A"])[0].trim(),
                email: (rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || ["N/A"])[0],
                address: rawText.substring(0, 100) + "...",
                website: "N/A"
            });
        }

        // Clean and Parse JSON from Gemini
        let ext = { name: "N/A", company: "N/A", title: "N/A", phone: "N/A", email: "N/A", address: "N/A", website: "N/A" };
        try {
            const jsonStr = responseText.replace(/```json|```/g, "").trim();
            ext = JSON.parse(jsonStr);
        } catch (e) {
            console.error("Gemini JSON Parse Error:", responseText);
        }

        console.log("Gemini Extracted Data:", ext);

        // Map extra fields to existing DB columns
        const productNotes = `Email: ${ext.email} | Web: ${ext.website} | Title: ${ext.title}`;

        // --- STEP: Database Storage ---
        await client.query(
            `INSERT INTO Customer_Data 
            ("Phn No (i18n)", Name, Address, Product_Notes, photo_binary, BusinessType, JobID) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                ext.phone || "N/A",
                ext.name || "Unknown",
                ext.address || "Not found",
                productNotes,
                compressedBase64,
                ext.company || "Professional",
                jobId
            ]
        );

        await client.query("COMMIT");
        fs.unlinkSync(originalImagePath);

        res.status(200).json({
            message: "Success",
            jobId: jobId,
            extracted: ext // Fixed variable name from 'extracted' to 'ext'
        });

    } catch (err) {
        if (client) await client.query("ROLLBACK");
        console.error("Gemini Error:", err);
        res.status(500).json({ error: "AI Processing Failed", details: err.message });
    } finally {
        if (client) client.release();
    }
});

// ---------------- 5. VIEW RESULTS DASHBOARD ----------------
app.get("/results", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT j.JobID, c.Name, c."Phn No (i18n)", c.Address, c.photo_binary, c.BusinessType, c.Product_Notes
            FROM AI_Jobs j 
            JOIN Customer_Data c ON j.JobID = c.JobID 
            ORDER BY j.JobID DESC
        `);

        const rows = result.rows.map(row => `
            <div class="media-card">
                <div class="card-thumb">
                    <img src="data:image/jpeg;base64,${row.photo_binary}" alt="Card">
                    <div class="card-overlay">
                        <div style="font-size:11px; opacity:0.6;">#JOB-${row.jobid}</div>
                        <div style="font-weight:700; color:var(--accent); font-size:13px;">${row.businesstype || 'N/A'}</div>
                    </div>
                </div>
                <div class="card-info">
                    <div class="card-name">${row.name || 'Unknown'}</div>
                    <div class="card-sub">${row["Phn No (i18n)"] || 'No Number'}</div>
                </div>
                <!-- Detail Hover Tooltip -->
                <div class="card-details-hover">
                    <div style="margin-bottom:12px; font-weight:700; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; display:flex; justify-content:space-between;">
                        <span>Business Intelligence</span>
                        <span style="color:var(--primary)">•</span>
                    </div>
                    <p><b>Location:</b> ${row.address}</p>
                    <p><b>Metadata:</b> ${row.product_notes}</p>
                </div>
            </div>
        `).join('');

        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Archive - AI Cardio</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
        
        :root {
            --primary: #8b5cf6;
            --accent: #06b6d4;
            --bg: #0b0f1a;
            --glass: rgba(255, 255, 255, 0.03);
            --border: rgba(255, 255, 255, 0.08);
            --text: #f8fafc;
        }

        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 40px;
            overflow-x: hidden;
        }

        .header-bar {
            max-width: 1400px;
            margin: 0 auto 50px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        h1 { font-size: 32px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 15px; }
        h1::before { content: '📁'; font-size: 28px; }

        .gallery-grid {
            max-width: 1400px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 30px;
        }

        .media-card {
            position: relative;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: pointer;
        }

        .card-thumb {
            width: 100%;
            aspect-ratio: 16/10;
            background: #1e293b;
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid var(--border);
            position: relative;
            box-shadow: 0 15px 35px -5px rgba(0,0,0,0.5);
        }

        .card-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.5s;
        }

        .media-card:hover .card-thumb img { transform: scale(1.1); }
        .media-card:hover .card-thumb { border-color: var(--primary); box-shadow: 0 0 20px rgba(139, 92, 246, 0.2); }

        .card-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            padding: 15px;
            background: linear-gradient(to top, rgba(11, 15, 26, 0.9), transparent 60%);
        }

        .card-info {
            padding: 15px 5px;
        }

        .card-name {
            font-weight: 600;
            font-size: 17px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 4px;
        }

        .card-sub {
            font-size: 14px;
            color: #64748b;
        }

        .card-details-hover {
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%) translateY(-10px);
            width: 320px;
            background: #111827;
            border: 1px solid var(--primary);
            border-radius: 16px;
            padding: 20px;
            z-index: 100;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8);
            opacity: 0;
            visibility: hidden;
            transition: all 0.2s ease;
            pointer-events: none;
        }

        .media-card:hover .card-details-hover {
            opacity: 1;
            visibility: visible;
            transform: translateX(-50%) translateY(0);
        }

        .card-details-hover p { margin: 8px 0; line-height: 1.5; color: #94a3b8; font-size: 13px; }

        .btn-home {
            color: white;
            text-decoration: none;
            background: var(--glass);
            padding: 12px 24px;
            border-radius: 14px;
            border: 1px solid var(--border);
            font-weight: 600;
            transition: all 0.3s;
        }
        .btn-home:hover { background: var(--primary); transform: translateY(-2px); }
    </style>
</head>
<body>
    <div class="header-bar">
        <h1>Scanned Vault</h1>
        <a href="/" class="btn-home">← Back to Scanner</a>
    </div>

    <div class="gallery-grid">
        ${rows || '<div style="grid-column:1/-1; text-align:center; padding:100px; color:#475569; font-size:20px;">The vault is currently empty.</div>'}
    </div>
</body>
</html>
        `);
    } catch (err) {
        res.status(500).send("Error loading digital vault: " + err.message);
    }
});

app.listen(3000, () => {
    console.log("Server active at http://localhost:3000");
});
