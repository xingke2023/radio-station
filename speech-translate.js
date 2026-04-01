const express = require('express');
const cors = require('cors');
const keys = require('./keys');
const path = require('path');

const app = express();
const PORT = 8630;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public-translate')));

// 从本地 node_modules 提供 Azure Speech SDK 浏览器包
app.get('/sdk/speech.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules/microsoft-cognitiveservices-speech-sdk/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js'));
});
app.get('/sdk/speech-processor.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules/microsoft-cognitiveservices-speech-sdk/distrib/browser/speech-processor.js'));
});

// 优先 eastasia，其次全部
const preferredKeys = keys.filter(k => k.zonename === 'eastasia');
const keyPool = preferredKeys.length > 0 ? preferredKeys : keys;
let keyIndex = 0;

app.get('/api/speech-key', (req, res) => {
    const item = keyPool[keyIndex];
    keyIndex = (keyIndex + 1) % keyPool.length;
    console.log(`[speech-key] index=${keyIndex - 1}/${keyPool.length - 1}, region=${item.zonename}, key=${item.key.substring(0, 6)}...`);
    res.json({ key: item.key, region: item.zonename });
});

const GEMINI_API_KEY = 'AIzaSyCPT9tggD7Q8Zt78pVokxvduA9MO1falSs';
const GEMINI_MODEL = 'gemini-3-flash-preview';

app.use(express.json());

app.post('/api/gemini', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'no text' });

    const prompt = `You are a candidate being interviewed for a Desktop Engineer role. You have deep hands-on experience with IGEL thin clients, VDI, Windows, Microsoft Teams, and AV conference room equipment. You are very familiar with the IGEL knowledge base at https://kb.igel.com/ and apply that knowledge in your answers.

The interviewer's question (note: speech-to-text may have spelling errors, e.g. "igile", "igel", "igle", "eagle" all refer to IGEL; "UMS", "ums", "yum" refer to IGEL UMS; "VDI", "V.D.I" refer to Virtual Desktop Infrastructure — interpret charitably):
"${text}"

Answer as the candidate in first person, confident and professional, drawing from IGEL KB knowledge where relevant. Format:
- English answer first (2-4 sentences, natural spoken style, reference specific IGEL concepts/features/tools like UMS, IGEL OS, profiles, firmware update, etc. where appropriate)
- Then Chinese translation below

No bullet points, no labels, no filler. Speak as if you are in the interview right now.`;

    try {
        const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1alpha/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    tools: [{ googleSearch: {} }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } }
                })
            }
        );
        const data = await resp.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const answer = parts.map(p => p.text || '').join('').trim() || '无法获取回答';
        res.json({ answer });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Speech Translate server running at http://localhost:${PORT}`);
});
