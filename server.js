const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==================== DATABASE CONNECTION (FIXED FOR RENDER/NEON) ====================
console.log('🔍 Checking DATABASE_URL:', process.env.DATABASE_URL ? '✅ Present' : '❌ Missing');

if (!process.env.DATABASE_URL) {
    console.error('❌ FATAL: DATABASE_URL environment variable is not set!');
    process.exit(1);
}

// Fix the connection string for Neon
let connectionString = process.env.DATABASE_URL;
if (!connectionString.includes('sslmode') && process.env.NODE_ENV === 'production') {
    connectionString += (connectionString.includes('?') ? '&' : '?') + 'sslmode=require';
}

const pool = new Pool({
    connectionString: connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    keepAlive: true,
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
        console.error('💡 Make sure DATABASE_URL is correct in Render environment variables');
    } else {
        console.log('✅ PostgreSQL connected successfully');
        release();
        createTables();
    }
});

// Handle connection errors
pool.on('error', (err) => {
    console.error('Unexpected database error:', err.message);
});

async function createTables() {
    const client = await pool.connect();
    try {
        // Users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                location TEXT,
                user_type VARCHAR(50) CHECK (user_type IN ('seeker', 'provider')) NOT NULL,
                rating DECIMAL(3,2) DEFAULT 0,
                total_reviews INTEGER DEFAULT 0,
                is_verified BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Users table ready');

        // Categories table
        await client.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                icon VARCHAR(10),
                description TEXT,
                display_order INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT true
            )
        `);
        console.log('✅ Categories table ready');

        // Job Posts table
        await client.query(`
            CREATE TABLE IF NOT EXISTS job_posts (
                id SERIAL PRIMARY KEY,
                seeker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                category_id INTEGER REFERENCES categories(id),
                title VARCHAR(255) NOT NULL,
                description TEXT,
                budget DECIMAL(10,2),
                location TEXT,
                preferred_date DATE,
                status VARCHAR(50) DEFAULT 'open',
                views INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Job posts table ready');

        // Bids table
        await client.query(`
            CREATE TABLE IF NOT EXISTS bids (
                id SERIAL PRIMARY KEY,
                job_post_id INTEGER REFERENCES job_posts(id) ON DELETE CASCADE,
                provider_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                amount DECIMAL(10,2) NOT NULL,
                estimated_days INTEGER,
                message TEXT,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bids table ready');

        // Provider Services table
        await client.query(`
            CREATE TABLE IF NOT EXISTS provider_services (
                id SERIAL PRIMARY KEY,
                provider_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                category_id INTEGER REFERENCES categories(id),
                title VARCHAR(255) NOT NULL,
                description TEXT,
                price DECIMAL(10,2),
                price_type VARCHAR(50) DEFAULT 'fixed',
                experience_years INTEGER,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Provider services table ready');

        // Direct Hires table
        await client.query(`
            CREATE TABLE IF NOT EXISTS direct_hires (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                provider_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                service_id INTEGER REFERENCES provider_services(id),
                agreed_amount DECIMAL(10,2) NOT NULL,
                message TEXT,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Direct hires table ready');

        // Accepted Jobs table
        await client.query(`
            CREATE TABLE IF NOT EXISTS accepted_jobs (
                id SERIAL PRIMARY KEY,
                job_post_id INTEGER REFERENCES job_posts(id),
                provider_id INTEGER REFERENCES users(id),
                seeker_id INTEGER REFERENCES users(id),
                bid_id INTEGER REFERENCES bids(id),
                agreed_amount DECIMAL(10,2),
                platform_commission DECIMAL(10,2),
                provider_earnings DECIMAL(10,2),
                status VARCHAR(50) DEFAULT 'accepted',
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Accepted jobs table ready');

        // Conversations table for chat
        await client.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                job_id INTEGER REFERENCES job_posts(id) ON DELETE CASCADE,
                direct_hire_id INTEGER REFERENCES direct_hires(id) ON DELETE CASCADE,
                seeker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                provider_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_message TEXT,
                last_message_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                seeker_unread_count INTEGER DEFAULT 0,
                provider_unread_count INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT true
            )
        `);
        console.log('✅ Conversations table ready');

        // Messages table
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT false,
                read_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                message_type VARCHAR(50) DEFAULT 'text',
                attachment_url TEXT,
                offer_amount DECIMAL(10,2)
            )
        `);
        console.log('✅ Messages table ready');

        // Insert default categories
        const catCount = await client.query('SELECT COUNT(*) FROM categories');
        if (parseInt(catCount.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO categories (name, icon, description, display_order) VALUES
                ('Plumbing', '🔧', 'Plumbing services including repairs and installations', 1),
                ('Electrical', '⚡', 'Electrical repairs and wiring services', 2),
                ('Cleaning', '🧹', 'Home and office cleaning services', 3),
                ('Tutoring', '📚', 'Academic tutoring and coaching', 4),
                ('Computer Repair', '💻', 'Computer and laptop repair services', 5),
                ('Photography', '📸', 'Photography and videography services', 6),
                ('Driving', '🚗', 'Driving services and lessons', 7),
                ('Catering', '🍳', 'Food catering for events', 8),
                ('Construction', '🏗️', 'Construction and renovation services', 9),
                ('Painting', '🎨', 'Painting and decorating services', 10)
            `);
            console.log('✅ Default categories added');
        }

        console.log('✅ All tables created/verified');
    } catch (error) {
        console.error('Table creation error:', error);
    } finally {
        client.release();
    }
}

// ==================== AUTH MIDDLEWARE ====================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
};

// ==================== AUTH ROUTES ====================
app.post('/api/auth/register', async (req, res) => {
    const { email, password, full_name, phone, location, user_type } = req.body;
    
    if (!email || !password || !full_name || !user_type) {
        return res.status(400).json({ success: false, message: 'All required fields must be filled' });
    }
    
    try {
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const result = await pool.query(
            `INSERT INTO users (email, password_hash, full_name, phone, location, user_type, is_verified)
             VALUES ($1, $2, $3, $4, $5, $6, true)
             RETURNING id, email, full_name, user_type`,
            [email, hashedPassword, full_name, phone, location, user_type]
        );
        
        const user = result.rows[0];
        const token = jwt.sign(
            { id: user.id, email: user.email, user_type: user.user_type },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({ success: true, token, user });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const result = await pool.query(
            'SELECT id, email, password_hash, full_name, user_type, is_active FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
        
        const token = jwt.sign(
            { id: user.id, email: user.email, user_type: user.user_type },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                user_type: user.user_type
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, full_name, phone, location, user_type, rating, is_verified FROM users WHERE id = $1',
            [req.user.id]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==================== CATEGORIES ====================
app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories WHERE is_active = true ORDER BY display_order');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== JOB POSTS ====================
app.get('/api/jobs', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT jp.*, c.name as category_name, c.icon as category_icon,
                    u.full_name as seeker_name, u.location as seeker_location
             FROM job_posts jp
             JOIN categories c ON jp.category_id = c.id
             JOIN users u ON jp.seeker_id = u.id
             WHERE jp.status = 'open'
             ORDER BY jp.created_at DESC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/jobs/my', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'seeker') {
        return res.status(403).json([]);
    }
    
    try {
        const result = await pool.query(
            `SELECT jp.*, c.name as category_name,
                    (SELECT COUNT(*) FROM bids WHERE job_post_id = jp.id) as bid_count
             FROM job_posts jp
             JOIN categories c ON jp.category_id = c.id
             WHERE jp.seeker_id = $1
             ORDER BY jp.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/jobs', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'seeker') {
        return res.status(403).json({ success: false, message: 'Only seekers can post jobs' });
    }
    
    const { category_id, title, description, budget, location, preferred_date } = req.body;
    
    if (!category_id || !title || !description) {
        return res.status(400).json({ success: false, message: 'Category, title, and description are required' });
    }
    
    try {
        const result = await pool.query(
            `INSERT INTO job_posts (seeker_id, category_id, title, description, budget, location, preferred_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [req.user.id, category_id, title, description, budget, location, preferred_date]
        );
        res.json({ success: true, job: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/jobs/:jobId/bids', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT b.*, u.full_name as provider_name, u.rating as provider_rating
             FROM bids b
             JOIN users u ON b.provider_id = u.id
             WHERE b.job_post_id = $1
             ORDER BY b.amount ASC`,
            [req.params.jobId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== BIDS ====================
app.post('/api/jobs/:jobId/bids', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can place bids' });
    }
    
    const { amount, estimated_days, message } = req.body;
    
    try {
        const existingBid = await pool.query(
            'SELECT id FROM bids WHERE job_post_id = $1 AND provider_id = $2',
            [req.params.jobId, req.user.id]
        );
        
        if (existingBid.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'You already bid on this job' });
        }
        
        const result = await pool.query(
            `INSERT INTO bids (job_post_id, provider_id, amount, estimated_days, message)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [req.params.jobId, req.user.id, amount, estimated_days, message]
        );
        
        res.json({ success: true, bid: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/bids/:bidId/accept', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'seeker') {
        return res.status(403).json({ success: false, message: 'Only seekers can accept bids' });
    }
    
    try {
        const bidResult = await pool.query(
            `SELECT b.*, jp.seeker_id, jp.id as job_id
             FROM bids b
             JOIN job_posts jp ON b.job_post_id = jp.id
             WHERE b.id = $1`,
            [req.params.bidId]
        );
        
        const bid = bidResult.rows[0];
        
        if (bid.seeker_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        
        await pool.query('UPDATE bids SET status = $1 WHERE id = $2', ['accepted', req.params.bidId]);
        await pool.query('UPDATE job_posts SET status = $1 WHERE id = $2', ['assigned', bid.job_id]);
        
        const commission = bid.amount * 0.10;
        const providerEarnings = bid.amount - commission;
        
        await pool.query(
            `INSERT INTO accepted_jobs (job_post_id, provider_id, seeker_id, bid_id, agreed_amount, platform_commission, provider_earnings)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [bid.job_id, bid.provider_id, req.user.id, req.params.bidId, bid.amount, commission, providerEarnings]
        );
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== PROVIDER ENDPOINTS ====================
app.get('/api/provider/bids', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') return res.status(403).json([]);
    
    try {
        const result = await pool.query(
            `SELECT b.*, jp.title as job_title, jp.budget as job_budget
             FROM bids b
             JOIN job_posts jp ON b.job_post_id = jp.id
             WHERE b.provider_id = $1
             ORDER BY b.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/provider/jobs', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') return res.status(403).json([]);
    
    try {
        const result = await pool.query(
            `SELECT aj.*, jp.title as job_title, u.full_name as seeker_name, u.phone as seeker_phone
             FROM accepted_jobs aj
             JOIN job_posts jp ON aj.job_post_id = jp.id
             JOIN users u ON aj.seeker_id = u.id
             WHERE aj.provider_id = $1
             ORDER BY aj.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== MARK JOB AS COMPLETE (FIXED) ====================
app.put('/api/provider/jobs/:jobId/status', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can update job status' });
    }
    
    const { jobId } = req.params;
    const { status } = req.body;
    
    try {
        // Check if job exists and belongs to this provider
        const checkJob = await pool.query(
            `SELECT id, job_post_id, provider_id, status 
             FROM accepted_jobs 
             WHERE id = $1 AND provider_id = $2`,
            [jobId, req.user.id]
        );
        
        if (checkJob.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Job not found or not assigned to you' 
            });
        }
        
        const currentJob = checkJob.rows[0];
        
        if (currentJob.status === 'completed') {
            return res.status(400).json({ 
                success: false, 
                message: 'Job is already marked as complete' 
            });
        }
        
        // Update accepted_jobs
        await pool.query(
            `UPDATE accepted_jobs 
             SET status = $1, completed_at = CURRENT_TIMESTAMP 
             WHERE id = $2 AND provider_id = $3`,
            [status, jobId, req.user.id]
        );
        
        // Update job_posts if exists
        if (currentJob.job_post_id) {
            await pool.query(
                `UPDATE job_posts SET status = $1 WHERE id = $2`,
                ['completed', currentJob.job_post_id]
            );
        }
        
        res.json({ success: true, message: 'Job marked as complete!' });
    } catch (error) {
        console.error('Update job status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PROVIDER SERVICES ====================
app.get('/api/provider/services', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') return res.status(403).json([]);
    
    try {
        const result = await pool.query(
            `SELECT ps.*, c.name as category_name
             FROM provider_services ps
             JOIN categories c ON ps.category_id = c.id
             WHERE ps.provider_id = $1 AND ps.is_active = true
             ORDER BY ps.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/provider/services', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') return res.status(403).json({ success: false });
    
    const { category_id, title, description, price, price_type, experience_years } = req.body;
    
    try {
        const result = await pool.query(
            `INSERT INTO provider_services (provider_id, category_id, title, description, price, price_type, experience_years)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [req.user.id, category_id, title, description, price, price_type, experience_years]
        );
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/provider/services/:id', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') return res.status(403).json({ success: false });
    
    try {
        await pool.query('DELETE FROM provider_services WHERE id = $1 AND provider_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== MARKETPLACE & DIRECT HIRE ====================
app.get('/api/services/marketplace', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ps.*, u.full_name as provider_name, u.location as provider_location, u.rating as provider_rating,
                    c.name as category_name, c.icon as category_icon
             FROM provider_services ps
             JOIN users u ON ps.provider_id = u.id
             JOIN categories c ON ps.category_id = c.id
             WHERE ps.is_active = true AND u.is_active = true
             ORDER BY u.rating DESC, ps.created_at DESC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/direct-hire', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'seeker') {
        return res.status(403).json({ success: false, message: 'Only seekers can hire providers' });
    }
    
    const { service_id, provider_id, message, agreed_amount } = req.body;
    
    try {
        const result = await pool.query(
            `INSERT INTO direct_hires (customer_id, provider_id, service_id, message, agreed_amount, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             RETURNING *`,
            [req.user.id, provider_id, service_id, message, agreed_amount]
        );
        res.json({ success: true, hire: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/provider/hire-requests', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') return res.status(403).json([]);
    
    try {
        const result = await pool.query(
            `SELECT dh.*, u.full_name as customer_name, u.phone as customer_phone, ps.title as service_title
             FROM direct_hires dh
             JOIN users u ON dh.customer_id = u.id
             JOIN provider_services ps ON dh.service_id = ps.id
             WHERE dh.provider_id = $1 AND dh.status = 'pending'
             ORDER BY dh.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/direct-hire/:id/respond', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') return res.status(403).json({ success: false });
    
    const { status } = req.body;
    
    try {
        await pool.query('UPDATE direct_hires SET status = $1 WHERE id = $2 AND provider_id = $3', [status, req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/seeker/direct-hires', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'seeker') return res.status(403).json([]);
    
    try {
        const result = await pool.query(
            `SELECT dh.*, u.full_name as provider_name, u.rating as provider_rating, ps.title as service_title
             FROM direct_hires dh
             JOIN users u ON dh.provider_id = u.id
             JOIN provider_services ps ON dh.service_id = ps.id
             WHERE dh.customer_id = $1
             ORDER BY dh.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== CHAT / MESSAGING SYSTEM ====================

async function getOrCreateConversation(seekerId, providerId, jobId = null, directHireId = null) {
    let query = `SELECT * FROM conversations WHERE seeker_id = $1 AND provider_id = $2`;
    let params = [seekerId, providerId];
    
    if (jobId) {
        query += ` AND job_id = $3`;
        params.push(jobId);
    }
    
    let result = await pool.query(query, params);
    
    if (result.rows.length > 0) {
        return result.rows[0];
    }
    
    const insertResult = await pool.query(
        `INSERT INTO conversations (seeker_id, provider_id, job_id, direct_hire_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [seekerId, providerId, jobId || null, directHireId || null]
    );
    
    return insertResult.rows[0];
}

app.post('/api/conversations', authenticateToken, async (req, res) => {
    const { provider_id, job_id, direct_hire_id } = req.body;
    
    if (req.user.user_type !== 'seeker') {
        return res.status(403).json({ success: false, message: 'Only seekers can initiate conversations' });
    }
    
    try {
        const conversation = await getOrCreateConversation(req.user.id, provider_id, job_id, direct_hire_id);
        res.json({ success: true, conversation });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/conversations/provider', authenticateToken, async (req, res) => {
    const { seeker_id, job_id, direct_hire_id } = req.body;
    
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can initiate conversations' });
    }
    
    try {
        const conversation = await getOrCreateConversation(seeker_id, req.user.id, job_id, direct_hire_id);
        res.json({ success: true, conversation });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
    const { conversation_id, receiver_id, message, message_type, offer_amount } = req.body;
    
    try {
        let conversation;
        let receiverId = receiver_id;
        
        if (conversation_id) {
            const convResult = await pool.query('SELECT * FROM conversations WHERE id = $1', [conversation_id]);
            if (convResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Conversation not found' });
            }
            conversation = convResult.rows[0];
            receiverId = conversation.seeker_id === req.user.id ? conversation.provider_id : conversation.seeker_id;
        } else {
            if (!receiver_id) {
                return res.status(400).json({ success: false, message: 'Receiver ID required' });
            }
            const seekerId = req.user.user_type === 'seeker' ? req.user.id : receiver_id;
            const providerId = req.user.user_type === 'provider' ? req.user.id : receiver_id;
            conversation = await getOrCreateConversation(seekerId, providerId);
        }
        
        const result = await pool.query(
            `INSERT INTO messages (conversation_id, sender_id, receiver_id, message, message_type, offer_amount, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
             RETURNING *`,
            [conversation.id, req.user.id, receiverId, message, message_type || 'text', offer_amount || null]
        );
        
        await pool.query(
            `UPDATE conversations 
             SET last_message = $1, last_message_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
                 ${req.user.user_type === 'seeker' ? 'seeker_unread_count = seeker_unread_count + 1' : 'provider_unread_count = provider_unread_count + 1'}
             WHERE id = $2`,
            [message || `💰 Offer: GHS ${offer_amount}`, conversation.id]
        );
        
        const messageWithSender = await pool.query(
            `SELECT m.*, u.full_name as sender_name, u.user_type as sender_type
             FROM messages m 
             JOIN users u ON m.sender_id = u.id 
             WHERE m.id = $1`,
            [result.rows[0].id]
        );
        
        res.json({ success: true, message: messageWithSender.rows[0] });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/conversations/:conversationId/messages', authenticateToken, async (req, res) => {
    const { conversationId } = req.params;
    
    try {
        const convResult = await pool.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);
        
        if (convResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }
        
        const conversation = convResult.rows[0];
        
        if (conversation.seeker_id !== req.user.id && conversation.provider_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        
        const messagesResult = await pool.query(
            `SELECT m.*, u.full_name as sender_name, u.user_type as sender_type
             FROM messages m 
             JOIN users u ON m.sender_id = u.id
             WHERE m.conversation_id = $1 
             ORDER BY m.created_at ASC`,
            [conversationId]
        );
        
        await pool.query(
            `UPDATE messages 
             SET is_read = true, read_at = CURRENT_TIMESTAMP
             WHERE conversation_id = $1 AND receiver_id = $2 AND is_read = false`,
            [conversationId, req.user.id]
        );
        
        if (req.user.user_type === 'seeker') {
            await pool.query('UPDATE conversations SET seeker_unread_count = 0 WHERE id = $1', [conversationId]);
        } else {
            await pool.query('UPDATE conversations SET provider_unread_count = 0 WHERE id = $1', [conversationId]);
        }
        
        res.json({ success: true, messages: messagesResult.rows, conversation });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        let query;
        let params = [req.user.id];
        
        if (req.user.user_type === 'seeker') {
            query = `
                SELECT c.*, u.full_name as other_user_name, u.user_type as other_user_type,
                       jp.title as job_title
                FROM conversations c
                JOIN users u ON c.provider_id = u.id
                LEFT JOIN job_posts jp ON c.job_id = jp.id
                WHERE c.seeker_id = $1
                ORDER BY c.updated_at DESC
            `;
        } else {
            query = `
                SELECT c.*, u.full_name as other_user_name, u.user_type as other_user_type,
                       jp.title as job_title
                FROM conversations c
                JOIN users u ON c.seeker_id = u.id
                LEFT JOIN job_posts jp ON c.job_id = jp.id
                WHERE c.provider_id = $1
                ORDER BY c.updated_at DESC
            `;
        }
        
        const result = await pool.query(query, params);
        
        const conversationsWithUnread = result.rows.map(conv => ({
            ...conv,
            unread_count: req.user.user_type === 'seeker' ? conv.seeker_unread_count : conv.provider_unread_count
        }));
        
        res.json({ success: true, conversations: conversationsWithUnread });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/messages/unread-count', authenticateToken, async (req, res) => {
    try {
        let result;
        if (req.user.user_type === 'seeker') {
            result = await pool.query(
                'SELECT COALESCE(SUM(seeker_unread_count), 0) as total FROM conversations WHERE seeker_id = $1',
                [req.user.id]
            );
        } else {
            result = await pool.query(
                'SELECT COALESCE(SUM(provider_unread_count), 0) as total FROM conversations WHERE provider_id = $1',
                [req.user.id]
            );
        }
        const unreadCount = parseInt(result.rows[0].total) || 0;
        res.json({ success: true, unread_count: unreadCount });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/messages/offer', authenticateToken, async (req, res) => {
    const { conversation_id, receiver_id, offer_amount, message } = req.body;
    
    if (!offer_amount || offer_amount <= 0) {
        return res.status(400).json({ success: false, message: 'Valid offer amount is required' });
    }
    
    try {
        let conversation;
        let receiverId = receiver_id;
        
        if (conversation_id) {
            const convResult = await pool.query('SELECT * FROM conversations WHERE id = $1', [conversation_id]);
            conversation = convResult.rows[0];
            receiverId = conversation.seeker_id === req.user.id ? conversation.provider_id : conversation.seeker_id;
        } else {
            if (!receiver_id) {
                return res.status(400).json({ success: false, message: 'Receiver ID required' });
            }
            const seekerId = req.user.user_type === 'seeker' ? req.user.id : receiver_id;
            const providerId = req.user.user_type === 'provider' ? req.user.id : receiver_id;
            conversation = await getOrCreateConversation(seekerId, providerId);
        }
        
        const result = await pool.query(
            `INSERT INTO messages (conversation_id, sender_id, receiver_id, message, message_type, offer_amount, created_at)
             VALUES ($1, $2, $3, $4, 'offer', $5, CURRENT_TIMESTAMP)
             RETURNING *`,
            [conversation.id, req.user.id, receiverId, message || `Offering GHS ${offer_amount}`, offer_amount]
        );
        
        await pool.query(
            `UPDATE conversations 
             SET last_message = $1, last_message_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
                 ${req.user.user_type === 'seeker' ? 'seeker_unread_count = seeker_unread_count + 1' : 'provider_unread_count = provider_unread_count + 1'}
             WHERE id = $2`,
            [`💰 Offer: GHS ${offer_amount}`, conversation.id]
        );
        
        res.json({ success: true, message: result.rows[0] });
    } catch (error) {
        console.error('Send offer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== DASHBOARD STATS ====================
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type === 'provider') {
            const result = await pool.query(
                `SELECT 
                    (SELECT COUNT(*) FROM accepted_jobs WHERE provider_id = $1) as total_jobs,
                    (SELECT COUNT(*) FROM accepted_jobs WHERE provider_id = $1 AND status = 'completed') as completed_jobs,
                    (SELECT COALESCE(SUM(provider_earnings), 0) FROM accepted_jobs WHERE provider_id = $1 AND status = 'completed') as total_earnings,
                    (SELECT COUNT(*) FROM bids WHERE provider_id = $1) as total_bids`,
                [req.user.id]
            );
            res.json(result.rows[0]);
        } else {
            const result = await pool.query(
                `SELECT 
                    (SELECT COUNT(*) FROM job_posts WHERE seeker_id = $1) as total_jobs_posted,
                    (SELECT COUNT(*) FROM bids b JOIN job_posts jp ON b.job_post_id = jp.id WHERE jp.seeker_id = $1) as total_bids_received,
                    (SELECT COUNT(*) FROM direct_hires WHERE customer_id = $1) as total_direct_hires`,
                [req.user.id]
            );
            res.json(result.rows[0]);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Service Connect Platform is running!' });
});

// ==================== SERVE FRONTEND (FIXED) ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/seeker-dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'seeker-dashboard.html'));
});

app.get('/provider-dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'provider-dashboard.html'));
});

app.get('/marketplace.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'marketplace.html'));
});

app.get('/chat.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║     🔗 SERVICE CONNECT PLATFORM                                   ║
║     Connecting Service Providers with Customers                   ║
║                                                                   ║
║     ✅ Server running on port ${PORT}                               ║
║     ✅ Database connected                                          ║
║     ✅ Chat System Ready                                           ║
║     ✅ Mark Complete Fixed                                         ║
║     ✅ Static Files Serving Fixed                                  ║
║                                                                   ║
║     🌐 Visit: https://your-app.onrender.com                       ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `);
});