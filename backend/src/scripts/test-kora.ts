import { KoraClient } from '@solana/kora';
import 'dotenv/config';

async function testConnection() {
    console.log('Testing with RPC URL:', process.env.KORA_RPC_URL  ? '✅ Present' : '❌ Missing');
    console.log('Testing with API Key:', process.env.KORA_API_KEY  ? '✅ Present' : '❌ Missing');
    console.log('Testing with HMAC Secret:', process.env.KORA_HMAC_SECRET ? '✅ Present' : '❌ Missing');
    const client = new KoraClient({
        rpcUrl: process.env.KORA_RPC_URL || 'http://localhost:8080',
        apiKey: process.env.KORA_API_KEY  || '',
        hmacSecret: process.env.KORA_HMAC_SECRET || '',
    });
  
    try {
        const config = await client.getConfig();
        console.log('✅ Successfully connected to Kora server');
        console.log('Fee Payers Available:', config.fee_payers);
        console.log('Fee Payers Available:', config.validation_config);
    } catch (error: any) {
        console.error('❌ Connection failed:', error.message);
    }
}

testConnection();