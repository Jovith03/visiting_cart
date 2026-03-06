const { Client, Databases, Storage, ID, Query, InputFile } = require("node-appwrite");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const sharp = require("sharp");
const busboy = require("busboy");

module.exports = async function (context) {
    const { req, res, log, error } = context;

    // Initialize Appwrite Client
    const client = new Client()
        .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT || 'https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
        .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const databases = new Databases(client);
    const storage = new Storage(client);

    const APPWRITE_DB_ID = process.env.APPWRITE_DATABASE_ID;
    const APPWRITE_COLLECTION_ID = process.env.APPWRITE_COLLECTION_ID;
    const APPWRITE_BUCKET_ID = process.env.APPWRITE_BUCKET_ID;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    // Helper: Parse Multipart Form
    const parseForm = (req) => {
        return new Promise((resolve, reject) => {
            const bb = busboy({ headers: req.headers });
            const result = { files: [], fields: {} };

            bb.on('file', (name, file, info) => {
                const chunks = [];
                file.on('data', (data) => chunks.push(data));
                file.on('end', () => {
                    result.files.push({
                        name,
                        buffer: Buffer.concat(chunks),
                        filename: info.filename,
                        mimeType: info.mimeType
                    });
                });
            });

            bb.on('field', (name, val) => {
                result.fields[name] = val;
            });

            bb.on('finish', () => resolve(result));
            bb.on('error', (err) => reject(err));

            // Appwrite passes body as string or buffer
            if (req.bodyBinary) {
                bb.end(req.bodyBinary);
            } else if (typeof req.body === 'string') {
                bb.end(Buffer.from(req.body));
            } else {
                bb.end(req.body);
            }
        });
    };

    // Routing
    const path = req.path;
    const method = req.method;

    try {
        // --- ROUTE: POST /upload ---
        if ((path === '/upload' || path === '/api/upload') && method === 'POST') {
            log("Processing card upload...");
            const form = await parseForm(req);
            const cardFile = form.files[0];

            if (!cardFile) {
                return res.json({ success: false, error: "No file uploaded" }, 400);
            }

            // 1. Process Image with Sharp
            log("Optimizing image...");
            const optimizedBuffer = await sharp(cardFile.buffer)
                .resize({ width: 1200 })
                .jpeg({ quality: 85 })
                .toBuffer();

            const base64Image = optimizedBuffer.toString("base64");

            // 2. AI Extraction (Gemini)
            log("Calling Gemini AI...");
            const prompt = `Extract info from business card. Return ONLY JSON: name, phone, email, address, website, company. No markdown.`;
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const aiResult = await model.generateContent([
                { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
                { text: prompt }
            ]);

            const responseText = aiResult.response.text();
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            const extractedData = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

            // 3. Upload to Appwrite Storage
            log("Saving to Appwrite Storage...");
            const appwriteStore = await storage.createFile(
                APPWRITE_BUCKET_ID,
                ID.unique(),
                InputFile.fromBuffer(optimizedBuffer, 'card.jpg')
            );

            // 4. Save to Database
            log("Saving metadata to Database...");
            const dbResult = await databases.createDocument(
                APPWRITE_DB_ID,
                APPWRITE_COLLECTION_ID,
                ID.unique(),
                {
                    name: extractedData.name || "N/A",
                    phone: extractedData.phone || "N/A",
                    email: extractedData.email || "N/A",
                    address: extractedData.address || "N/A",
                    website: extractedData.website || "N/A",
                    company: extractedData.company || "N/A",
                    photoId: appwriteStore.$id
                }
            );

            return res.json({
                success: true,
                id: dbResult.$id,
                data: extractedData
            });
        }

        // --- ROUTE: GET /archive ---
        if (path === '/api/archive' && method === 'GET') {
            const result = await databases.listDocuments(
                APPWRITE_DB_ID,
                APPWRITE_COLLECTION_ID,
                [Query.orderDesc("$createdAt")]
            );
            const docs = result.documents.map(doc => ({
                id: doc.$id,
                ...doc,
                created_at: doc.$createdAt
            }));
            return res.json(docs);
        }

        // --- ROUTE: DELETE /archive/:id ---
        if (path.startsWith('/api/archive/') && method === 'DELETE') {
            const id = path.split('/').pop();
            const doc = await databases.getDocument(APPWRITE_DB_ID, APPWRITE_COLLECTION_ID, id);

            if (doc.photoId) {
                try { await storage.deleteFile(APPWRITE_BUCKET_ID, doc.photoId); } catch (e) { }
            }
            await databases.deleteDocument(APPWRITE_DB_ID, APPWRITE_COLLECTION_ID, id);
            return res.json({ success: true });
        }

        // --- ROUTE: GET /image/:id ---
        if (path.startsWith('/api/image/') && method === 'GET') {
            const photoId = path.split('/').pop();
            const fileBuffer = await storage.getFileView(APPWRITE_BUCKET_ID, photoId);
            return res.send(fileBuffer, 200, { "Content-Type": "image/jpeg" });
        }

        return res.json({ error: "Not Found" }, 404);

    } catch (err) {
        error("Error in Function: " + err.message);
        return res.json({ success: false, error: err.message }, 500);
    }
};
