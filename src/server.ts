import express from 'express';
import { env } from './config/env.js';

const app = express();
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
    res.send('NEXUS Debug Server is LIVE 🚀');
});

app.all(['/voice', '/api/twilio', '/api/twilio/voice'], (req, res) => {
    console.log(`[Debug] Hit voice endpoint: ${req.url}`);
    res.type('text/xml');
    res.send('<Response><Say>Hola, esto es una prueba de NEXUS.</Say></Response>');
});

export function startServer() {
    const port = env.PORT;
    app.listen(port, () => {
        console.log(`[Server] Debug server running on port ${port}`);
    });
}
