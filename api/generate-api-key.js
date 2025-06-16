import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed'
        });
    }
    
    try {
        console.log('🚀 API Key generation request received');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        
        const { email, googleData } = req.body;
        
        // Validate required fields
        if (!email) {
            console.error('❌ Missing email in request');
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }
        
        if (!email.includes('@')) {
            console.error('❌ Invalid email format:', email);
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }
        
        console.log('✅ Email validation passed:', email);
        
        // Check if user already exists
        console.log('🔍 Checking if user exists...');
        const { data: existingUser, error: userCheckError } = await supabase.auth.admin.listUsers();
        
        let userId = null;
        const existingUserAccount = existingUser?.users?.find(user => user.email === email);
        
        if (existingUserAccount) {
            console.log('✅ User already exists:', existingUserAccount.id);
            userId = existingUserAccount.id;
            
            // Check if they already have an API key
            const { data: existingApiKey } = await supabase
                .from('api_keys')
                .select('api_key')
                .eq('user_id', userId)
                .eq('is_active', true)
                .single();
                
            if (existingApiKey) {
                console.log('✅ Returning existing API key');
                
                // Get existing user data
                const { data: userData } = await supabase
                    .from('user_usage')
                    .select('*')
                    .eq('user_id', userId)
                    .single();
                
                return res.status(200).json({
                    success: true,
                    apiKey: existingApiKey.api_key,
                    user: {
                        email: email,
                        name: googleData?.name || email.split('@')[0],
                        picture: googleData?.picture || null,
                        userId: userId
                    },
                    trial: {
                        isActive: userData?.plan === 'trial',
                        unlimited: userData?.plan !== 'trial' || new Date() < new Date(userData?.trial_ends_at)
                    }
                });
            }
        } else {
            // Create new user in Supabase Auth
            console.log('🆕 Creating new user...');
            const { data: newUser, error: createUserError } = await supabase.auth.admin.createUser({
                email: email,
                email_confirm: true,
                user_metadata: {
                    name: googleData?.name || email.split('@')[0],
                    picture: googleData?.picture || null
                }
            });
            
            if (createUserError) {
                console.error('❌ Failed to create user:', createUserError);
                throw createUserError;
            }
            
            userId = newUser.user.id;
            console.log('✅ New user created:', userId);
        }
        
        // Generate API key
        const apiKey = generateApiKey(email);
        console.log('✅ API key generated');
        
        // Calculate trial end date (7 days from now)
        const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        // Insert API key into database
        console.log('💾 Saving API key to database...');
        const { error: apiKeyError } = await supabase
            .from('api_keys')
            .insert({
                user_id: userId,
                api_key: apiKey,
                is_active: true,
                created_at: new Date().toISOString()
            });
            
        if (apiKeyError) {
            console.error('❌ Failed to save API key:', apiKeyError);
            throw apiKeyError;
        }
        
        console.log('✅ API key saved to database');
        
        // Insert or update user usage data
        console.log('💾 Setting up user usage...');
        const { error: usageError } = await supabase
            .from('user_usage')
            .upsert({
                user_id: userId,
                plan: 'trial',
                trial_ends_at: trialEndsAt,
                uploads_today: 0,
                uploads_this_month: 0,
                total_uploads: 0,
                created_at: new Date().toISOString()
            });
            
        if (usageError) {
            console.error('❌ Failed to setup user usage:', usageError);
            throw usageError;
        }
        
        console.log('✅ User usage setup complete');
        
        const responseData = {
            success: true,
            apiKey: apiKey,
            user: {
                email: email,
                name: googleData?.name || email.split('@')[0],
                picture: googleData?.picture || null,
                userId: userId,
                createdAt: new Date().toISOString()
            },
            trial: {
                isActive: true,
                daysRemaining: 7,
                unlimited: true,
                expiresAt: trialEndsAt
            }
        };
        
        console.log('✅ Sending successful response');
        return res.status(200).json(responseData);
        
    } catch (error) {
        console.error('❌ API Key generation failed:', error);
        console.error('Error stack:', error.stack);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// Helper function to generate API key
function generateApiKey(email) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 15);
    const emailHash = Buffer.from(email).toString('base64').substring(0, 8);
    
    return `csvw_${emailHash}_${timestamp}_${randomStr}`;
}
