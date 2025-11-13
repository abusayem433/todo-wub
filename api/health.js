// Vercel serverless function for health check

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

    return res.json({ 
        status: 'OK', 
        message: 'Server is running',
        services: {
            sms: 'Ready'
        }
    });
};

