import Groq from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
async function main() {
    const models = await groq.models.list();
    console.log(models.data.map(m => m.id));
}
main();
