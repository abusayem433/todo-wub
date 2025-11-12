// Express server for SMS Gateway

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve static files

// SMS Gateway Configuration
const SMS_CONFIG = {
    API_KEY: 'pxqPNN0nSx81VmGf0NSj',
    SENDER_ID: '8809617623731',  // Using working sender ID
    API_URL: 'http://bulksmsbd.net/api/smsapi',
    BALANCE_URL: 'http://bulksmsbd.net/api/getBalanceApi'
};


// Send SMS endpoint
app.post('/api/send-sms', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
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
        console.error('SMS sending error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Check balance endpoint
app.get('/api/sms-balance', async (req, res) => {
    try {
        const url = `${SMS_CONFIG.BALANCE_URL}?api_key=${SMS_CONFIG.API_KEY}`;
        const response = await fetch(url);
        const balance = await response.text();
        
        res.json({ 
            success: true, 
            balance: balance 
        });
    } catch (error) {
        console.error('Balance check error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});


// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Server is running',
        services: {
            sms: 'Ready'
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all interfaces for production

app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`📱 SMS API ready at /api/send-sms`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

