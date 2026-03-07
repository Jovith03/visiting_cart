require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const mainFunc = require('./main');

const app = express();

app.use(cors());

// Parse any incoming request as a raw Buffer so busboy in main.js can handle it
app.use(express.raw({ type: '*/*', limit: '10mb' }));

app.all('*', async (req, res) => {
    const context = {
        req: {
            path: req.path,
            method: req.method,
            headers: req.headers,
            bodyBinary: Buffer.isBuffer(req.body) ? req.body : undefined,
            body: req.body
        },
        res: {
            json: (data, statusCode = 200) => {
                return res.status(statusCode).json(data);
            },
            send: (data, statusCode = 200, headers = {}) => {
                Object.entries(headers).forEach(([k, v]) => res.set(k, v));
                return res.status(statusCode).send(data);
            }
        },
        log: (msg) => console.log(`[LOG]`, msg),
        error: (msg) => console.error(`[ERROR]`, msg)
    };

    try {
        await mainFunc(context);
    } catch (e) {
        console.error("Unhandled error:", e);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}...`);
});
