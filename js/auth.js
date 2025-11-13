// Authentication functionality
let phoneNumber = '';
let phonePassword = '';

// Get server URL - works in both development and production
// To override in production, set window.API_BASE_URL before loading this script
// Example: <script>window.API_BASE_URL = 'https://api.yourdomain.com';</script>
function getServerUrl() {
    // Check if we have an environment variable or config
    if (window.API_BASE_URL) {
        return window.API_BASE_URL;
    }
    
    // In production, use same origin (server serves static files)
    // In development, use localhost:3000
    const isProduction = window.location.hostname !== 'localhost' && 
                        window.location.hostname !== '127.0.0.1' &&
                        !window.location.hostname.startsWith('192.168.');
    
    if (isProduction) {
        // Production: use same origin
        return window.location.origin;
    } else {
        // Development: use localhost:3000
        return `${window.location.protocol}//${window.location.hostname}:3000`;
    }
}

// Button loading state helpers
function setButtonLoading(button, loading = true) {
    if (loading) {
        button.classList.add('loading');
        button.disabled = true;
        
        // Add spinner if not exists
        if (!button.querySelector('.spinner')) {
            const spinner = document.createElement('i');
            spinner.className = 'spinner';
            button.appendChild(spinner);
        }
    } else {
        button.classList.remove('loading');
        button.disabled = false;
        
        // Remove spinner
        const spinner = button.querySelector('.spinner');
        if (spinner) {
            spinner.remove();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Check if user is already logged in
    checkAuth();

    // Form toggle
    const showRegister = document.getElementById('showRegister');
    const showLogin = document.getElementById('showLogin');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    showRegister.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.classList.remove('active');
        registerForm.classList.add('active');
        clearMessage();
    });

    showLogin.addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.classList.remove('active');
        loginForm.classList.add('active');
        clearMessage();
    });

    // Google Sign In/Sign Up
    document.getElementById('googleLoginBtn').addEventListener('click', signInWithGoogle);
    document.getElementById('googleSignUpBtn').addEventListener('click', signInWithGoogle);

    // Auth method tabs
    const authTabs = document.querySelectorAll('.auth-tab');
    authTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const method = tab.dataset.method;
            switchAuthMethod(method);
        });
    });

    // Login form submission
    document.getElementById('loginFormElement').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        setButtonLoading(submitBtn, true);

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            showMessage('Login successful! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1000);
        } catch (error) {
            showMessage(error.message, 'error');
            setButtonLoading(submitBtn, false);
        }
    });

    // Email registration form submission
    document.getElementById('registerEmailForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('registerConfirmPassword').value;

        if (password !== confirmPassword) {
            showMessage('Passwords do not match!', 'error');
            return;
        }

        if (password.length < 6) {
            showMessage('Password must be at least 6 characters long!', 'error');
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        setButtonLoading(submitBtn, true);

        try {
            // Sign up user directly with Supabase
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: name
                    }
                }
            });

            if (error) throw error;

            // Create profile
            if (data.user) {
                const { error: profileError } = await supabase
                    .from('profiles')
                    .insert([
                        { id: data.user.id, full_name: name }
                    ]);

                if (profileError) console.error('Profile creation error:', profileError);
            }

            showMessage('✅ Registration successful! Redirecting to dashboard...', 'success');
            
            // Auto-redirect to dashboard
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1000);
        } catch (error) {
            showMessage(error.message, 'error');
            setButtonLoading(submitBtn, false);
        }
    });

    // Phone registration - Send OTP
    document.getElementById('registerPhoneForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('registerNamePhone').value;
        const phone = document.getElementById('registerPhone').value;
        const password = document.getElementById('registerPasswordPhone').value;

        // Validate phone format (Bangladesh format)
        const phoneRegex = /^(\+880|880|0)?1[3-9]\d{8}$/;
        if (!phoneRegex.test(phone)) {
            showMessage('Please enter a valid Bangladesh phone number (e.g., +8801712345678 or 01712345678)', 'error');
            return;
        }

        if (password.length < 6) {
            showMessage('Password must be at least 6 characters long!', 'error');
            return;
        }

        // Store for later use
        phoneNumber = phone;
        phonePassword = password;

        const submitBtn = e.target.querySelector('button[type="submit"]');
        setButtonLoading(submitBtn, true);

        try {
            // Generate 6-digit OTP
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            
            // Hash password for storage
            const passwordHash = btoa(password); // Simple encoding (use bcrypt in production)
            
            // Calculate expiration time (5 minutes from now)
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + 5);
            
            // Store OTP in database
            const { data: otpData, error: otpError } = await supabase
                .from('phone_otps')
                .insert([{
                    phone_number: phone,
                    otp_code: otp,
                    full_name: name,
                    password_hash: passwordHash,
                    expires_at: expiresAt.toISOString(),
                    attempts: 0,
                    verified: false
                }])
                .select();

            if (otpError) {
                console.error('Database error inserting OTP:', otpError);
                // Provide more specific error message
                if (otpError.code === 'PGRST116' || otpError.message.includes('relation') || otpError.message.includes('does not exist')) {
                    throw new Error('Database table not found. Please contact support to set up the phone_otps table.');
                } else if (otpError.code === '23505' || otpError.message.includes('duplicate')) {
                    throw new Error('An OTP was recently sent. Please wait a moment before requesting a new one.');
                } else {
                    throw new Error(`Database error: ${otpError.message || 'Failed to store OTP. Please try again.'}`);
                }
            }

            // Send OTP via SMS
            const message = `Your TaskMaster OTP is ${otp}. Valid for 5 minutes. Do not share with anyone.`;
            
            const serverUrl = getServerUrl();
            const apiUrl = `${serverUrl}/api/send-sms`;
            
            console.log('Attempting to send SMS:', { serverUrl, apiUrl, phone });
            
            const smsResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    phoneNumber: phone,
                    message: message
                })
            }).catch(fetchError => {
                // Network error (server not reachable)
                console.error('Network error calling SMS API:', fetchError);
                throw new Error(`Cannot connect to SMS service. Please ensure the server is running. Error: ${fetchError.message}`);
            });

            // Check if response is ok
            if (!smsResponse.ok) {
                let errorMessage = `Server error: ${smsResponse.status} ${smsResponse.statusText}`;
                let errorDetails = null;
                
                try {
                    const errorData = await smsResponse.json();
                    console.error('SMS API error response:', errorData);
                    if (errorData.message) {
                        errorMessage = errorData.message;
                    }
                    if (errorData.error) {
                        errorDetails = errorData.error;
                    }
                } catch (e) {
                    // If response is not JSON, try to get text
                    try {
                        const errorText = await smsResponse.text();
                        console.error('SMS API error (text):', errorText);
                        if (errorText) {
                            errorMessage = `Server error: ${errorText}`;
                        }
                    } catch (textError) {
                        // If we can't read the response, use status
                        console.error('Could not read error response:', textError);
                    }
                }
                
                // Provide more helpful error message based on status code
                if (smsResponse.status === 500) {
                    errorMessage = `Internal Server Error: ${errorMessage}. Please check server logs or contact support.`;
                } else if (smsResponse.status === 404) {
                    errorMessage = `SMS service endpoint not found. Please ensure the server is running and accessible at ${apiUrl}`;
                } else if (smsResponse.status === 0 || smsResponse.status === '') {
                    errorMessage = `Cannot connect to SMS service. The server may not be running or there may be a CORS issue. Server URL: ${apiUrl}`;
                }
                
                throw new Error(errorMessage);
            }

            const smsResult = await smsResponse.json();

            if (!smsResult.success) {
                throw new Error(smsResult.message || 'Failed to send SMS. Please try again.');
            }

            showMessage('📱 OTP sent to your phone! Please check your messages.', 'success');
            
            // Show OTP verification form
            document.getElementById('registerPhoneForm').style.display = 'none';
            document.getElementById('verifyOtpForm').style.display = 'block';
            setButtonLoading(submitBtn, false);
        } catch (error) {
            console.error('OTP sending error (full details):', {
                error,
                message: error.message,
                code: error.code,
                details: error.details,
                hint: error.hint,
                phone: phone,
                serverUrl: getServerUrl()
            });
            
            // Provide more helpful error messages
            let errorMessage = error.message || 'An unexpected error occurred';
            
            // Database errors
            if (error.message && error.message.includes('Database')) {
                errorMessage = error.message;
            }
            // Network errors
            else if (error.message && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
                errorMessage = 'Unable to connect to SMS service. Please check your internet connection or contact support.';
            }
            // CORS errors
            else if (error.message && error.message.includes('CORS')) {
                errorMessage = 'CORS error: Please ensure the API server is properly configured.';
            }
            // Server errors
            else if (error.message && error.message.includes('Server error')) {
                errorMessage = `Server error: ${error.message}. Please contact support if this persists.`;
            }
            // Supabase errors
            else if (error.code || error.details) {
                errorMessage = `Error: ${error.message || 'Database operation failed'}. Please try again or contact support.`;
            }
            
            showMessage(errorMessage, 'error');
            setButtonLoading(submitBtn, false);
        }
    });

    // OTP verification form submission
    document.getElementById('verifyOtpForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const otpCode = document.getElementById('otpCode').value;

        if (otpCode.length !== 6) {
            showMessage('Please enter a valid 6-digit OTP code', 'error');
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        setButtonLoading(submitBtn, true);

        try {
            // Verify OTP from database
            const { data: otpData, error: otpError } = await supabase
                .from('phone_otps')
                .select('*')
                .eq('phone_number', phoneNumber)
                .eq('otp_code', otpCode)
                .eq('verified', false)
                .gt('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (otpError || !otpData) {
                // Try to increment attempts (optional - for tracking)
                // Note: This requires a database function or we fetch and update
                try {
                    const { data: existingOtp } = await supabase
                        .from('phone_otps')
                        .select('attempts')
                        .eq('phone_number', phoneNumber)
                        .eq('verified', false)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();
                    
                    if (existingOtp) {
                        await supabase
                            .from('phone_otps')
                            .update({ attempts: (existingOtp.attempts || 0) + 1 })
                            .eq('phone_number', phoneNumber)
                            .eq('verified', false);
                    }
                } catch (err) {
                    // Ignore attempt tracking errors
                    console.warn('Could not update attempt count:', err);
                }

                throw new Error('Invalid or expired OTP code. Please try again.');
            }

            // OTP is valid - Create user account
            const password = atob(otpData.password_hash);
            
            const { data: userData, error: signUpError } = await supabase.auth.signUp({
                email: `${phoneNumber.replace(/\+/g, '')}@phone.taskmaster.app`, // Create email from phone
                password: password,
                phone: phoneNumber,
                options: {
                    data: {
                        full_name: otpData.full_name,
                        phone_verified: true,
                        auth_method: 'phone'
                    }
                }
            });

            if (signUpError) throw signUpError;

            // Mark OTP as verified
            await supabase
                .from('phone_otps')
                .update({ verified: true })
                .eq('id', otpData.id);

            // Create profile
            if (userData.user) {
                const { error: profileError } = await supabase
                    .from('profiles')
                    .insert([
                        { id: userData.user.id, full_name: otpData.full_name }
                    ]);

                if (profileError) console.error('Profile creation error:', profileError);
            }

            showMessage('✅ Phone verified! Logging you in...', 'success');
            
            // Auto-login and redirect
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1500);
        } catch (error) {
            showMessage(error.message || 'OTP verification failed', 'error');
            setButtonLoading(submitBtn, false);
        }
    });

    // Resend OTP button
    document.getElementById('resendOtpBtn').addEventListener('click', async (e) => {
        if (!phoneNumber || !phonePassword) {
            showMessage('Please start the registration process again', 'error');
            return;
        }

        const resendBtn = e.target;
        setButtonLoading(resendBtn, true);

        try {
            // Generate new OTP
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const name = document.getElementById('registerNamePhone').value;
            const passwordHash = btoa(phonePassword);
            
            // Delete old unverified OTPs for this phone number
            await supabase
                .from('phone_otps')
                .delete()
                .eq('phone_number', phoneNumber)
                .eq('verified', false);
            
            // Calculate expiration time (5 minutes from now)
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + 5);
            
            // Store new OTP in database
            const { error: otpError } = await supabase
                .from('phone_otps')
                .insert([{
                    phone_number: phoneNumber,
                    otp_code: otp,
                    full_name: name,
                    password_hash: passwordHash,
                    expires_at: expiresAt.toISOString(),
                    attempts: 0,
                    verified: false
                }]);

            if (otpError) {
                console.error('Database error inserting OTP (resend):', otpError);
                if (otpError.code === 'PGRST116' || otpError.message.includes('relation') || otpError.message.includes('does not exist')) {
                    throw new Error('Database table not found. Please contact support to set up the phone_otps table.');
                } else {
                    throw new Error(`Database error: ${otpError.message || 'Failed to store OTP. Please try again.'}`);
                }
            }

            // Send OTP via SMS
            const message = `Your TaskMaster OTP is ${otp}. Valid for 5 minutes. Do not share with anyone.`;
            
            const serverUrl = getServerUrl();
            const apiUrl = `${serverUrl}/api/send-sms`;
            
            console.log('Attempting to resend SMS:', { serverUrl, apiUrl, phoneNumber });
            
            const smsResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    phoneNumber: phoneNumber,
                    message: message
                })
            }).catch(fetchError => {
                // Network error (server not reachable)
                console.error('Network error calling SMS API (resend):', fetchError);
                throw new Error(`Cannot connect to SMS service. Please ensure the server is running. Error: ${fetchError.message}`);
            });

            // Check if response is ok
            if (!smsResponse.ok) {
                let errorMessage = `Server error: ${smsResponse.status} ${smsResponse.statusText}`;
                let errorDetails = null;
                
                try {
                    const errorData = await smsResponse.json();
                    console.error('SMS API error response (resend):', errorData);
                    if (errorData.message) {
                        errorMessage = errorData.message;
                    }
                    if (errorData.error) {
                        errorDetails = errorData.error;
                    }
                } catch (e) {
                    // If response is not JSON, try to get text
                    try {
                        const errorText = await smsResponse.text();
                        console.error('SMS API error (text, resend):', errorText);
                        if (errorText) {
                            errorMessage = `Server error: ${errorText}`;
                        }
                    } catch (textError) {
                        // If we can't read the response, use status
                        console.error('Could not read error response (resend):', textError);
                    }
                }
                
                // Provide more helpful error message based on status code
                if (smsResponse.status === 500) {
                    errorMessage = `Internal Server Error: ${errorMessage}. Please check server logs or contact support.`;
                } else if (smsResponse.status === 404) {
                    errorMessage = `SMS service endpoint not found. Please ensure the server is running and accessible at ${apiUrl}`;
                } else if (smsResponse.status === 0 || smsResponse.status === '') {
                    errorMessage = `Cannot connect to SMS service. The server may not be running or there may be a CORS issue. Server URL: ${apiUrl}`;
                }
                
                throw new Error(errorMessage);
            }

            const smsResult = await smsResponse.json();

            if (!smsResult.success) {
                throw new Error(smsResult.message || 'Failed to send SMS. Please try again.');
            }

            showMessage('📱 OTP resent! Please check your messages.', 'success');
        } catch (error) {
            console.error('SMS resend error:', error);
            // Provide more helpful error messages
            let errorMessage = error.message;
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                errorMessage = 'Unable to connect to SMS service. Please check your internet connection or contact support.';
            } else if (error.message.includes('CORS')) {
                errorMessage = 'CORS error: Please ensure the API server is properly configured.';
            }
            showMessage(errorMessage, 'error');
        } finally {
            setButtonLoading(resendBtn, false);
        }
    });
});

// Switch between auth methods
function switchAuthMethod(method) {
    // Update tabs
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.method === method) {
            tab.classList.add('active');
        }
    });

    // Update forms
    document.querySelectorAll('.auth-method-form').forEach(form => {
        form.classList.remove('active');
        form.style.display = 'none';
    });

    if (method === 'email') {
        document.getElementById('registerEmailForm').classList.add('active');
        document.getElementById('registerEmailForm').style.display = 'block';
    } else if (method === 'phone') {
        document.getElementById('registerPhoneForm').classList.add('active');
        document.getElementById('registerPhoneForm').style.display = 'block';
    }

    clearMessage();
}

async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        // Use relative path to ensure it works on any domain
        const currentPath = window.location.pathname;
        if (currentPath.includes('index.html') || currentPath === '/' || currentPath.endsWith('/')) {
            window.location.href = 'dashboard.html';
        }
        // If already on dashboard or other page, don't redirect
    }
}

function showMessage(message, type) {
    const messageDiv = document.getElementById('authMessage');
    messageDiv.textContent = message;
    messageDiv.className = `auth-message ${type}`;
}

function clearMessage() {
    const messageDiv = document.getElementById('authMessage');
    messageDiv.textContent = '';
    messageDiv.className = 'auth-message';
}

// Google Sign In
async function signInWithGoogle(event) {
    const button = event.target.closest('button');
    setButtonLoading(button, true);
    
    try {
        // Get the current origin (works for both localhost and production)
        const currentOrigin = window.location.origin;
        const redirectUrl = `${currentOrigin}/dashboard.html`;
        
        console.log('OAuth redirect URL:', redirectUrl);
        
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                }
            }
        });

        if (error) throw error;

        // The redirect will happen automatically
        // No need to show message as user will be redirected to Google

    } catch (error) {
        console.error('Google sign-in error:', error);
        showMessage('Failed to sign in with Google: ' + error.message, 'error');
        setButtonLoading(button, false);
    }
}
