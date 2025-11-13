// Vercel serverless function for sending SMS
const fetch = require('node-fetch');

// SMS Gateway Configuration
const SMS_CONFIG = {
    API_KEY: 'pxqPNN0nSx81VmGf0NSj',
    SENDER_ID: '8809617623731',  // Using working sender ID
    API_URL: 'http://bulksmsbd.net/api/smsapi',
    BALANCE_URL: 'http://bulksmsbd.net/api/getBalanceApi'
};

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed. Use POST.' 
        });
    }

    try {
        const { phoneNumber, message } = req.body;

        console.log('SMS request received:', { phoneNumber, messageLength: message?.length });

        if (!phoneNumber || !message) {
            console.error('Missing required fields:', { phoneNumber: !!phoneNumber, message: !!message });
            return res.status(400).json({ 
                success: false, 
                message: 'Phone number and message are required' 
            });
        }

        // Format phone number (ensure it starts with 880)
        let formattedNumber = phoneNumber.replace(/\+/g, '');
        if (!formattedNumber.startsWith('880')) {
            if (formattedNumber.startsWith('0')) {
                formattedNumber = '880' + formattedNumber.substring(1);
            } else if (formattedNumber.startsWith('1')) {
                formattedNumber = '880' + formattedNumber;
            }
        }

        // Build API URL
        const params = new URLSearchParams({
            api_key: SMS_CONFIG.API_KEY,
            type: 'text',
            number: formattedNumber,
            senderid: SMS_CONFIG.SENDER_ID,
            message: message
        });

        const url = `${SMS_CONFIG.API_URL}?${params.toString()}`;

        // Send SMS
        const response = await fetch(url);
        const result = await response.text();

        // Try to parse as JSON first (newer API format)
        let responseCode, responseData;
        try {
            responseData = JSON.parse(result);
            responseCode = responseData.response_code?.toString();
            
            if (responseCode === '202' || responseData.success_message) {
                return res.json({ 
                    success: true, 
                    message: 'SMS sent successfully',
                    code: '202'
                });
            }
        } catch (e) {
            // Not JSON, treat as plain text code
            responseCode = result.trim();
        }
        
        // Check response code
        if (responseCode === '202' || result.includes('202')) {
            return res.json({ 
                success: true, 
                message: 'SMS sent successfully',
                code: '202'
            });
        } else {
            // Map error codes to messages
            const errorMessages = {
                '1001': 'Invalid phone number',
                '1002': 'Sender ID not correct or disabled',
                '1003': 'Required fields missing',
                '1005': 'Internal SMS gateway error - Sender ID may not be configured',
                '1006': 'Balance validity not available',
                '1007': 'Insufficient SMS balance',
                '1011': 'User ID not found',
                '1031': 'Account not verified with SMS provider',
                '1032': 'IP not whitelisted'
            };
            
            const errorMessage = errorMessages[responseCode] || 'SMS gateway error';
            const detailMsg = responseData?.error_message || errorMessage;
            
            return res.json({ 
                success: false, 
                message: `${errorMessage} (Code: ${responseCode})`,
                code: responseCode,
                detail: detailMsg
            });
        }

    } catch (error) {
        console.error('SMS sending error:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        return res.status(500).json({ 
            success: false, 
            message: error.message || 'Internal server error while sending SMS',
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

