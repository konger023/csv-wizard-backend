// pages/api/sheet-info.js
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Verify API key
        const authHeader = req.headers.authorization;
        const apiKey = authHeader?.replace('Bearer ', '');
        
        if (!apiKey) {
            return res.status(401).json({ error: 'No API key provided' });
        }

        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('api_key', apiKey)
            .single();

        if (!user) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        const { spreadsheetId, googleToken } = req.body;
        
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: googleToken });
        
        const sheets = google.sheets({ version: 'v4', auth });
        
        // Get spreadsheet metadata
        const response = await sheets.spreadsheets.get({
            spreadsheetId: spreadsheetId
        });
        
        // Extract tab names
        const tabs = response.data.sheets.map(sheet => sheet.properties.title);
        
        res.json({
            success: true,
            tabs: tabs,
            title: response.data.properties.title
        });
        
    } catch (error) {
        console.error('Sheet info error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get sheet info'
        });
    }
}
