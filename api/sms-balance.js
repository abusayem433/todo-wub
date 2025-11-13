// Vercel serverless function for checking SMS balance
const fetch = require('node-fetch');

// SMS Gateway Configuration
const SMS_CONFIG = {
    API_KEY: 'pxqPNN0nSx81VmGf0NSj',
    SENDER_ID: '8809617623731',
    API_URL: 'http://bulksmsbd.net/api/smsapi',
    BALANCE_URL: 'http://bulksmsbd.net/api/getBalanceApi'
};

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed. Use GET.' 
        });
    }

    try {
        const url = `${SMS_CONFIG.BALANCE_URL}?api_key=${SMS_CONFIG.API_KEY}`;
        const response = await fetch(url);
        const balance = await response.text();
        
        return res.json({ 
            success: true, 
            balance: balance 
        });
    } catch (error) {
        console.error('Balance check error:', error);
        return res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
};

