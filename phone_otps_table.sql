-- SQL script to create the phone_otps table in Supabase
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS phone_otps (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone_number TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER DEFAULT 0,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_phone_otps_phone_number ON phone_otps(phone_number);
CREATE INDEX IF NOT EXISTS idx_phone_otps_expires_at ON phone_otps(expires_at);
CREATE INDEX IF NOT EXISTS idx_phone_otps_verified ON phone_otps(verified);

-- Enable Row Level Security (RLS)
ALTER TABLE phone_otps ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust based on your security needs)
-- For OTP verification, you might want to restrict this further
CREATE POLICY "Allow all operations on phone_otps" ON phone_otps
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Optional: Create a function to automatically update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to update updated_at automatically
CREATE TRIGGER update_phone_otps_updated_at BEFORE UPDATE ON phone_otps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

