const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));
app.use(express.static(__dirname));

// ==================== DATABASE CONNECTION ====================
console.log('🔍 DATABASE_URL:', process.env.DATABASE_URL ? '✅ Present' : '❌ Missing');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
    } else {
        console.log('✅ Database connected at:', res.rows[0].now);
        createTables();
    }
});

async function createTables() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                location TEXT,
                user_type VARCHAR(50) CHECK (user_type IN ('seeker', 'provider', 'admin')) NOT NULL,
                rating DECIMAL(3,2) DEFAULT 0,
                total_reviews INTEGER DEFAULT 0,
                is_verified BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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

        await client.query(`
            CREATE TABLE IF NOT EXISTS accepted_jobs (
                id SERIAL PRIMARY KEY,
                job_post_id INTEGER REFERENCES job_posts(id),
                provider_id INTEGER REFERENCES users(id),
                seeker_id INTEGER REFERENCES users(id),
                bid_id INTEGER REFERENCES bids(id),
                service_id INTEGER REFERENCES provider_services(id),
                agreed_amount DECIMAL(10,2),
                platform_commission DECIMAL(10,2) DEFAULT 0,
                provider_earnings DECIMAL(10,2) DEFAULT 0,
                commission_rate DECIMAL(5,2) DEFAULT 10,
                status VARCHAR(50) DEFAULT 'accepted',
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS commission_transactions (
                id SERIAL PRIMARY KEY,
                job_id INTEGER REFERENCES accepted_jobs(id),
                amount DECIMAL(10,2) NOT NULL,
                commission_rate DECIMAL(5,2) DEFAULT 10,
                platform_earnings DECIMAL(10,2) NOT NULL,
                provider_id INTEGER REFERENCES users(id),
                seeker_id INTEGER REFERENCES users(id),
                status VARCHAR(50) DEFAULT 'pending',
                transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                payment_reference VARCHAR(255)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_settings (
                id SERIAL PRIMARY KEY,
                setting_key VARCHAR(100) UNIQUE NOT NULL,
                setting_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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

        const catCount = await client.query('SELECT COUNT(*) FROM categories');
        if (parseInt(catCount.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO categories (name, icon, description, display_order) VALUES
                ('Plumbing', '🔧', 'Plumbing services', 1),
                ('Electrical', '⚡', 'Electrical services', 2),
                ('Cleaning', '🧹', 'Cleaning services', 3),
                ('Tutoring', '📚', 'Tutoring services', 4),
                ('Computer Repair', '💻', 'Computer repair', 5),
                ('Photography', '📸', 'Photography services', 6),
                ('Driving', '🚗', 'Driving services', 7),
                ('Catering', '🍳', 'Catering services', 8),
                ('Construction', '🏗️', 'Construction services', 9),
                ('Painting', '🎨', 'Painting services', 10)
            `);
        }

        const rateCheck = await client.query(`SELECT * FROM admin_settings WHERE setting_key = 'commission_rate'`);
        if (rateCheck.rows.length === 0) {
            await client.query(`INSERT INTO admin_settings (setting_key, setting_value) VALUES ('commission_rate', '10')`);
        }

        console.log('✅ All tables ready');
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
        return res.status(401).json({ success: false, message: 'Access denied' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mysecretkey123');
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Invalid token' });
    }
};

// ==================== AUTH ROUTES ====================
app.post('/api/auth/register', async (req, res) => {
    const { email, password, full_name, phone, location, user_type } = req.body;
    
    if (!email || !password || !full_name) {
        return res.status(400).json({ success: false, message: 'Email, password, and full name required' });
    }
    
    try {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const result = await pool.query(
            `INSERT INTO users (email, password_hash, full_name, phone, location, user_type, is_verified)
             VALUES ($1, $2, $3, $4, $5, $6, true)
             RETURNING id, email, full_name, user_type`,
            [email, hashedPassword, full_name, phone || '', location || '', user_type || 'seeker']
        );
        
        const user = result.rows[0];
        const token = jwt.sign(
            { id: user.id, email: user.email, user_type: user.user_type },
            process.env.JWT_SECRET || 'mysecretkey123',
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
    
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    
    try {
        const result = await pool.query(
            'SELECT id, email, password_hash, full_name, user_type FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
        
        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
        
        await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
        
        const token = jwt.sign(
            { id: user.id, email: user.email, user_type: user.user_type },
            process.env.JWT_SECRET || 'mysecretkey123',
            { expiresIn: '7d' }
        );
        
        res.json({ success: true, token, user: { id: user.id, email: user.email, full_name: user.full_name, user_type: user.user_type } });
    } catch (error) {
        console.error('Login error:', error);
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
    if (req.user.user_type !== 'seeker') return res.status(403).json([]);
    
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
    
    const { bidId } = req.params;
    
    try {
        const bidResult = await pool.query(
            `SELECT b.*, jp.seeker_id, jp.id as job_id
             FROM bids b
             JOIN job_posts jp ON b.job_post_id = jp.id
             WHERE b.id = $1`,
            [bidId]
        );
        
        if (bidResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Bid not found' });
        }
        
        const bid = bidResult.rows[0];
        
        if (bid.seeker_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        
        if (bid.status !== 'pending') {
            return res.status(400).json({ success: false, message: `This bid has already been ${bid.status}` });
        }
        
        const rateResult = await pool.query(`SELECT setting_value FROM admin_settings WHERE setting_key = 'commission_rate'`);
        const commissionRate = rateResult.rows.length > 0 ? parseFloat(rateResult.rows[0].setting_value) : 10;
        
        const commission = (bid.amount * commissionRate) / 100;
        const providerEarnings = bid.amount - commission;
        
        await pool.query('BEGIN');
        
        await pool.query('UPDATE bids SET status = $1 WHERE id = $2', ['accepted', bidId]);
        await pool.query('UPDATE job_posts SET status = $1 WHERE id = $2', ['assigned', bid.job_id]);
        
        await pool.query(
            `INSERT INTO accepted_jobs (job_post_id, provider_id, seeker_id, bid_id, agreed_amount, platform_commission, provider_earnings, commission_rate, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'accepted')`,
            [bid.job_id, bid.provider_id, req.user.id, bidId, bid.amount, commission, providerEarnings, commissionRate]
        );
        
        await pool.query(
            `UPDATE bids SET status = 'rejected' 
             WHERE job_post_id = $1 AND id != $2 AND status = 'pending'`,
            [bid.job_id, bidId]
        );
        
        await pool.query('COMMIT');
        
        res.json({ success: true, message: `Bid accepted! Commission: ${commissionRate}%` });
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Accept bid error:', error);
        res.status(500).json({ success: false, error: error.message });
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
            `SELECT aj.*, jp.title as job_title, u.full_name as seeker_name, u.phone as seeker_phone, ps.title as service_title
             FROM accepted_jobs aj
             LEFT JOIN job_posts jp ON aj.job_post_id = jp.id
             LEFT JOIN provider_services ps ON aj.service_id = ps.id
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

app.put('/api/provider/jobs/:jobId/status', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') return res.status(403).json({ success: false });
    
    const { jobId } = req.params;
    const { status } = req.body;
    
    try {
        await pool.query(
            `UPDATE accepted_jobs 
             SET status = $1, completed_at = CURRENT_TIMESTAMP 
             WHERE id = $2 AND provider_id = $3`,
            [status, jobId, req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
            `SELECT ps.*, u.full_name as provider_name, u.location as provider_location,
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
        return res.status(403).json({ success: false });
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

// ==================== RESPOND TO HIRE REQUEST (FIXED) ====================
app.put('/api/direct-hire/:id/respond', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can respond' });
    }
    
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status || (status !== 'accepted' && status !== 'rejected')) {
        return res.status(400).json({ success: false, message: 'Status must be "accepted" or "rejected"' });
    }
    
    try {
        const hireResult = await pool.query(
            `SELECT dh.* FROM direct_hires dh WHERE dh.id = $1 AND dh.provider_id = $2`,
            [id, req.user.id]
        );
        
        if (hireResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Hire request not found' });
        }
        
        const hire = hireResult.rows[0];
        
        await pool.query(
            `UPDATE direct_hires SET status = $1 WHERE id = $2 AND provider_id = $3`,
            [status, id, req.user.id]
        );
        
        if (status === 'accepted') {
            const rateResult = await pool.query(`SELECT setting_value FROM admin_settings WHERE setting_key = 'commission_rate'`);
            const commissionRate = rateResult.rows.length > 0 ? parseFloat(rateResult.rows[0].setting_value) : 10;
            
            const commission = (hire.agreed_amount * commissionRate) / 100;
            const providerEarnings = hire.agreed_amount - commission;
            
            await pool.query(
                `INSERT INTO accepted_jobs (provider_id, seeker_id, service_id, agreed_amount, platform_commission, provider_earnings, commission_rate, status, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'accepted', CURRENT_TIMESTAMP)`,
                [req.user.id, hire.customer_id, hire.service_id, hire.agreed_amount, commission, providerEarnings, commissionRate]
            );
        }
        
        res.json({ success: true, message: status === 'accepted' ? 'Hire request accepted! Job added to My Jobs.' : 'Hire request declined' });
    } catch (error) {
        console.error('Respond error:', error);
        res.status(500).json({ success: false, error: error.message });
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

// ==================== CHAT SYSTEM ====================
async function getOrCreateConversation(seekerId, providerId, jobId = null, directHireId = null) {
    let result = await pool.query(
        `SELECT * FROM conversations WHERE seeker_id = $1 AND provider_id = $2`,
        [seekerId, providerId]
    );
    
    if (result.rows.length > 0) {
        return result.rows[0];
    }
    
    const insertResult = await pool.query(
        `INSERT INTO conversations (seeker_id, provider_id, job_id, direct_hire_id)
         VALUES ($1, $2, $3, $4)
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
    
    const conversation = await getOrCreateConversation(req.user.id, provider_id, job_id, direct_hire_id);
    res.json({ success: true, conversation });
});

app.post('/api/conversations/provider', authenticateToken, async (req, res) => {
    const { seeker_id, job_id, direct_hire_id } = req.body;
    
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can initiate conversations' });
    }
    
    const conversation = await getOrCreateConversation(seeker_id, req.user.id, job_id, direct_hire_id);
    res.json({ success: true, conversation });
});

app.post('/api/messages', authenticateToken, async (req, res) => {
    const { conversation_id, receiver_id, message } = req.body;
    
    try {
        let conversation;
        let receiverId = receiver_id;
        
        if (conversation_id) {
            const convResult = await pool.query('SELECT * FROM conversations WHERE id = $1', [conversation_id]);
            conversation = convResult.rows[0];
            receiverId = conversation.seeker_id === req.user.id ? conversation.provider_id : conversation.seeker_id;
        } else {
            const seekerId = req.user.user_type === 'seeker' ? req.user.id : receiver_id;
            const providerId = req.user.user_type === 'provider' ? req.user.id : receiver_id;
            conversation = await getOrCreateConversation(seekerId, providerId);
        }
        
        const result = await pool.query(
            `INSERT INTO messages (conversation_id, sender_id, receiver_id, message)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [conversation.id, req.user.id, receiverId, message]
        );
        
        await pool.query(
            `UPDATE conversations 
             SET last_message = $1, last_message_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [message, conversation.id]
        );
        
        res.json({ success: true, message: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/conversations/:conversationId/messages', authenticateToken, async (req, res) => {
    const { conversationId } = req.params;
    
    const convResult = await pool.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);
    if (convResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    
    const conversation = convResult.rows[0];
    if (conversation.seeker_id !== req.user.id && conversation.provider_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    const messagesResult = await pool.query(
        `SELECT m.*, u.full_name as sender_name
         FROM messages m JOIN users u ON m.sender_id = u.id
         WHERE m.conversation_id = $1 ORDER BY m.created_at ASC`,
        [conversationId]
    );
    
    res.json({ success: true, messages: messagesResult.rows, conversation });
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
    let query;
    if (req.user.user_type === 'seeker') {
        query = `
            SELECT c.*, u.full_name as other_user_name
            FROM conversations c
            JOIN users u ON c.provider_id = u.id
            WHERE c.seeker_id = $1
            ORDER BY c.updated_at DESC
        `;
    } else {
        query = `
            SELECT c.*, u.full_name as other_user_name
            FROM conversations c
            JOIN users u ON c.seeker_id = u.id
            WHERE c.provider_id = $1
            ORDER BY c.updated_at DESC
        `;
    }
    
    const result = await pool.query(query, [req.user.id]);
    res.json({ success: true, conversations: result.rows });
});

app.get('/api/messages/unread-count', authenticateToken, async (req, res) => {
    res.json({ success: true, unread_count: 0 });
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Service Connect is running!' });
});

// ==================== CREATE ADMIN ====================
app.get('/api/create-admin', async (req, res) => {
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('admin123', salt);
        
        await pool.query("DELETE FROM users WHERE email = 'admin@serviceconnect.com'");
        await pool.query(
            `INSERT INTO users (email, password_hash, full_name, user_type, is_verified)
             VALUES ($1, $2, $3, $4, true)`,
            ['admin@serviceconnect.com', hashedPassword, 'System Admin', 'admin']
        );
        
        res.json({ success: true, message: 'Admin created! Login: admin@serviceconnect.com / admin123' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SERVE FRONTEND ====================
function findHtmlFile(filename) {
    const paths = [path.join(__dirname, 'frontend', filename), path.join(__dirname, filename)];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

app.get('/', (req, res) => {
    const filePath = findHtmlFile('index.html');
    if (filePath) res.sendFile(filePath);
    else res.send('<h1>Service Connect API</h1><p>Server is running!</p>');
});

app.get('/provider-dashboard.html', (req, res) => {
    const filePath = findHtmlFile('provider-dashboard.html');
    if (filePath) res.sendFile(filePath);
    else res.status(404).send('File not found');
});

app.get('/seeker-dashboard.html', (req, res) => {
    const filePath = findHtmlFile('seeker-dashboard.html');
    if (filePath) res.sendFile(filePath);
    else res.status(404).send('File not found');
});

app.get('/marketplace.html', (req, res) => {
    const filePath = findHtmlFile('marketplace.html');
    if (filePath) res.sendFile(filePath);
    else res.status(404).send('File not found');
});

app.get('/chat.html', (req, res) => {
    const filePath = findHtmlFile('chat.html');
    if (filePath) res.sendFile(filePath);
    else res.status(404).send('File not found');
});

app.get('/admin-dashboard.html', (req, res) => {
    const filePath = findHtmlFile('admin-dashboard.html');
    if (filePath) res.sendFile(filePath);
    else res.status(404).send('File not found');
});
// ==================== ADMIN ENDPOINTS ====================

// ==================== ADMIN ENDPOINTS ====================

// Get all users (admin only)
app.get('/api/admin/users', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    
    try {
        const result = await pool.query(
            `SELECT id, email, full_name, phone, location, user_type, is_active, is_verified, created_at, last_login
             FROM users
             ORDER BY created_at DESC`
        );
        
        const seekers = result.rows.filter(u => u.user_type === 'seeker').length;
        const providers = result.rows.filter(u => u.user_type === 'provider').length;
        
        res.json({ 
            success: true, 
            users: result.rows,
            total: result.rows.length,
            seekers: seekers,
            providers: providers
        });
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all jobs (admin only) - FIXED
app.get('/api/admin/jobs', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    
    try {
        const result = await pool.query(`
            SELECT 
                jp.id,
                jp.title,
                jp.description,
                jp.budget,
                jp.location,
                jp.status,
                jp.views,
                jp.created_at,
                u.id as seeker_id,
                u.full_name as seeker_name,
                u.email as seeker_email,
                (SELECT COUNT(*) FROM bids WHERE job_post_id = jp.id) as bid_count
            FROM job_posts jp
            LEFT JOIN users u ON jp.seeker_id = u.id
            ORDER BY jp.created_at DESC
            LIMIT 100
        `);
        
        console.log(`📊 Admin: Found ${result.rows.length} jobs`);
        
        res.json({ 
            success: true, 
            jobs: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('Error getting jobs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get jobs stats (admin only)
app.get('/api/admin/jobs/stats', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') {
        return res.status(403).json({ success: false });
    }
    
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'open' THEN 1 END) as open,
                COUNT(CASE WHEN status = 'assigned' THEN 1 END) as assigned,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
            FROM job_posts
        `);
        
        res.json({ 
            success: true, 
            total: parseInt(result.rows[0].total) || 0,
            open: parseInt(result.rows[0].open) || 0,
            assigned: parseInt(result.rows[0].assigned) || 0,
            completed: parseInt(result.rows[0].completed) || 0
        });
    } catch (error) {
        console.error('Error getting jobs stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ADMIN ENDPOINTS (ALL FIXED) ====================

// Get all users
app.get('/api/admin/users', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    try {
        const result = await pool.query(`SELECT id, email, full_name, phone, location, user_type, created_at FROM users ORDER BY created_at DESC`);
        const seekers = result.rows.filter(u => u.user_type === 'seeker').length;
        const providers = result.rows.filter(u => u.user_type === 'provider').length;
        res.json({ success: true, users: result.rows, total: result.rows.length, seekers, providers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all jobs
app.get('/api/admin/jobs', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    try {
        const result = await pool.query(`SELECT jp.*, u.full_name as seeker_name, (SELECT COUNT(*) FROM bids WHERE job_post_id = jp.id) as bid_count FROM job_posts jp LEFT JOIN users u ON jp.seeker_id = u.id ORDER BY jp.created_at DESC LIMIT 100`);
        res.json({ success: true, jobs: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get jobs stats
app.get('/api/admin/jobs/stats', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    try {
        const result = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'open' THEN 1 END) as open, COUNT(CASE WHEN status = 'assigned' THEN 1 END) as assigned, COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed FROM job_posts`);
        res.json({ success: true, total: parseInt(result.rows[0].total) || 0, open: parseInt(result.rows[0].open) || 0, assigned: parseInt(result.rows[0].assigned) || 0, completed: parseInt(result.rows[0].completed) || 0 });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get earnings (potential)
app.get('/api/commission/earnings', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    try {
        const totalResult = await pool.query(`SELECT COALESCE(SUM(agreed_amount), 0) as total_value, COALESCE(SUM(platform_commission), 0) as total_commission, COUNT(*) as completed_count FROM accepted_jobs WHERE status = 'completed'`);
        const recentResult = await pool.query(`SELECT aj.id, aj.agreed_amount, aj.platform_commission, aj.completed_at, COALESCE(p.full_name, 'Unknown') as provider_name, COALESCE(s.full_name, 'Unknown') as seeker_name, COALESCE(jp.title, ps.title, 'Direct Hire') as job_title FROM accepted_jobs aj LEFT JOIN users p ON aj.provider_id = p.id LEFT JOIN users s ON aj.seeker_id = s.id LEFT JOIN job_posts jp ON aj.job_post_id = jp.id LEFT JOIN provider_services ps ON aj.service_id = ps.id WHERE aj.status = 'completed' ORDER BY aj.completed_at DESC LIMIT 50`);
        res.json({ success: true, total_transaction_value: parseFloat(totalResult.rows[0].total_value) || 0, total_potential_commission: parseFloat(totalResult.rows[0].total_commission) || 0, completed_jobs: parseInt(totalResult.rows[0].completed_count) || 0, recent_transactions: recentResult.rows || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get commission rate
app.get('/api/commission/rate', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`SELECT setting_value FROM admin_settings WHERE setting_key = 'commission_rate'`);
        const rate = result.rows.length > 0 ? parseFloat(result.rows[0].setting_value) : 10;
        res.json({ success: true, commission_rate: rate });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update commission rate
app.put('/api/commission/rate', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    const { rate } = req.body;
    if (!rate || rate < 0 || rate > 100) return res.status(400).json({ success: false, message: 'Rate must be between 0 and 100' });
    try {
        await pool.query(`INSERT INTO admin_settings (setting_key, setting_value, updated_at) VALUES ('commission_rate', $1, CURRENT_TIMESTAMP) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1, updated_at = CURRENT_TIMESTAMP`, [rate]);
        res.json({ success: true, message: `Commission rate updated to ${rate}%` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get provider services
app.get('/api/admin/services', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    try {
        const result = await pool.query(`SELECT ps.*, u.full_name as provider_name, c.name as category_name FROM provider_services ps LEFT JOIN users u ON ps.provider_id = u.id LEFT JOIN categories c ON ps.category_id = c.id WHERE ps.is_active = true ORDER BY ps.created_at DESC LIMIT 100`);
        res.json({ success: true, services: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Server running on port ${PORT}`);
    console.log(`🌐 https://service-connect-7akg.onrender.com\n`);
});
