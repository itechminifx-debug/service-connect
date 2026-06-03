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

// Email service (optional - will log if not configured)
let sendEmail = async (to, type, data) => {
    console.log(`📧 Email would be sent to ${to}: ${type}`);
    return true;
};

// Try to load email service if configured
try {
    const emailService = require('./emailService');
    if (emailService && emailService.sendEmail) {
        sendEmail = emailService.sendEmail;
        console.log('✅ Email service loaded');
    }
} catch (error) {
    console.log('⚠️ Email service not configured');
}

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
                external_provider_name VARCHAR(255),
                external_provider_phone VARCHAR(50),
                external_provider_email VARCHAR(255),
                share_token VARCHAR(100),
                posted_by_admin BOOLEAN DEFAULT false,
                is_public BOOLEAN DEFAULT false,
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
                service_id INTEGER REFERENCES provider_services(id) ON DELETE SET NULL,
                agreed_amount DECIMAL(10,2) NOT NULL,
                message TEXT,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS accepted_jobs (
                id SERIAL PRIMARY KEY,
                job_post_id INTEGER REFERENCES job_posts(id) ON DELETE SET NULL,
                provider_id INTEGER REFERENCES users(id),
                seeker_id INTEGER REFERENCES users(id),
                bid_id INTEGER REFERENCES bids(id) ON DELETE SET NULL,
                service_id INTEGER REFERENCES provider_services(id) ON DELETE SET NULL,
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
                job_id INTEGER REFERENCES accepted_jobs(id) ON DELETE SET NULL,
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

        await client.query(`
            CREATE TABLE IF NOT EXISTS portfolio_items (
                id SERIAL PRIMARY KEY,
                provider_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                image_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS contact_requests (
                id SERIAL PRIMARY KEY,
                provider_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        
        sendEmail(email, 'welcome', { name: full_name, userType: user_type || 'seeker' }).catch(console.error);
        
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
            'SELECT id, email, password_hash, full_name, user_type, is_active FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
        
        const user = result.rows[0];
        
        if (!user.is_active) {
            return res.status(401).json({ success: false, message: 'Account deactivated. Contact support.' });
        }
        
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
        const jobInfo = await pool.query(
            `SELECT jp.*, u.email as seeker_email, u.full_name as seeker_name 
             FROM job_posts jp
             JOIN users u ON jp.seeker_id = u.id
             WHERE jp.id = $1`,
            [req.params.jobId]
        );
        
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
        
        const providerInfo = await pool.query('SELECT full_name FROM users WHERE id = $1', [req.user.id]);
        
        if (jobInfo.rows.length > 0) {
            sendEmail(jobInfo.rows[0].seeker_email, 'newBid', {
                seekerName: jobInfo.rows[0].seeker_name,
                jobTitle: jobInfo.rows[0].title,
                bidAmount: amount,
                providerName: providerInfo.rows[0]?.full_name || 'A provider'
            }).catch(console.error);
        }
        
        res.json({ success: true, bid: result.rows[0] });
    } catch (error) {
        console.error('Place bid error:', error);
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
            `SELECT b.*, jp.seeker_id, jp.id as job_id, jp.title as job_title,
                    u.email as provider_email, u.full_name as provider_name
             FROM bids b
             JOIN job_posts jp ON b.job_post_id = jp.id
             JOIN users u ON b.provider_id = u.id
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
        
        const seekerInfo = await pool.query('SELECT full_name FROM users WHERE id = $1', [req.user.id]);
        
        sendEmail(bid.provider_email, 'bidAccepted', {
            providerName: bid.provider_name,
            jobTitle: bid.job_title,
            amount: bid.amount,
            seekerName: seekerInfo.rows[0]?.full_name || 'Customer'
        }).catch(console.error);
        
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

app.put('/api/provider/jobs/:jobId/status', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') return res.status(403).json({ success: false });
    
    const { jobId } = req.params;
    const { status } = req.body;
    
    try {
        const jobInfo = await pool.query(
            `SELECT aj.*, jp.title as job_title, 
                    s.email as seeker_email, s.full_name as seeker_name,
                    p.full_name as provider_name
             FROM accepted_jobs aj
             JOIN job_posts jp ON aj.job_post_id = jp.id
             JOIN users s ON aj.seeker_id = s.id
             JOIN users p ON aj.provider_id = p.id
             WHERE aj.id = $1 AND aj.provider_id = $2`,
            [jobId, req.user.id]
        );
        
        await pool.query(
            `UPDATE accepted_jobs 
             SET status = $1, completed_at = CURRENT_TIMESTAMP 
             WHERE id = $2 AND provider_id = $3`,
            [status, jobId, req.user.id]
        );
        
        if (status === 'completed' && jobInfo.rows.length > 0) {
            sendEmail(jobInfo.rows[0].seeker_email, 'jobCompleted', {
                seekerName: jobInfo.rows[0].seeker_name,
                jobTitle: jobInfo.rows[0].job_title,
                providerName: jobInfo.rows[0].provider_name,
                amount: jobInfo.rows[0].agreed_amount
            }).catch(console.error);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Update job status error:', error);
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
    
    if (!category_id || !title) {
        return res.status(400).json({ success: false, message: 'Category and title are required' });
    }
    
    try {
        const result = await pool.query(
            `INSERT INTO provider_services (provider_id, category_id, title, description, price, price_type, experience_years, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true)
             RETURNING *`,
            [req.user.id, category_id, title, description, price, price_type, experience_years || 0]
        );
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        console.error('Add service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/provider/services/:id', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') return res.status(403).json({ success: false });
    
    const { id } = req.params;
    const { title, description, price, price_type } = req.body;
    
    try {
        const verifyResult = await pool.query(
            'SELECT id FROM provider_services WHERE id = $1 AND provider_id = $2 AND is_active = true',
            [id, req.user.id]
        );
        
        if (verifyResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Service not found or not yours' });
        }
        
        const result = await pool.query(
            `UPDATE provider_services 
             SET title = COALESCE($1, title),
                 description = COALESCE($2, description),
                 price = COALESCE($3, price),
                 price_type = COALESCE($4, price_type)
             WHERE id = $5 AND provider_id = $6
             RETURNING *`,
            [title, description, price, price_type, id, req.user.id]
        );
        
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        console.error('Update service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/provider/services/:id', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can delete services' });
    }
    
    const { id } = req.params;
    
    try {
        const checkResult = await pool.query(
            'SELECT id, title FROM provider_services WHERE id = $1 AND provider_id = $2 AND is_active = true',
            [id, req.user.id]
        );
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Service not found or not yours' });
        }
        
        await pool.query(
            'UPDATE provider_services SET is_active = false WHERE id = $1 AND provider_id = $2',
            [id, req.user.id]
        );
        
        res.json({ success: true, message: 'Service deleted successfully' });
    } catch (error) {
        console.error('Delete service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== MARKETPLACE API (FIXED) ====================
app.get('/api/services/marketplace', authenticateToken, async (req, res) => {
    try {
        console.log('📊 Marketplace API called - User:', req.user.id, 'Type:', req.user.user_type);
        
        // PROVIDER VIEW - Only their own services
        if (req.user.user_type === 'provider') {
            const services = await pool.query(`
                SELECT 
                    ps.id, ps.title, ps.description, ps.price, ps.price_type,
                    ps.provider_id, ps.created_at,
                    'service' as item_type
                FROM provider_services ps
                WHERE ps.provider_id = $1 AND ps.is_active = true
                ORDER BY ps.created_at DESC
            `, [req.user.id]);
            
            console.log(`📊 Provider ${req.user.id}: ${services.rows.length} services`);
            return res.json(services.rows);
        }
        
        // SEEKER VIEW - All services AND public jobs
        const services = await pool.query(`
            SELECT 
                ps.id, ps.title, ps.description, ps.price, ps.price_type,
                ps.provider_id, ps.created_at,
                u.full_name as provider_name, u.location as provider_location,
                COALESCE(u.rating, 0)::float as provider_rating,
                c.name as category_name, c.icon as category_icon, c.id as category_id,
                'service' as item_type
            FROM provider_services ps
            JOIN users u ON ps.provider_id = u.id
            JOIN categories c ON ps.category_id = c.id
            WHERE ps.is_active = true AND u.is_active = true
            ORDER BY ps.created_at DESC
        `);
        
        const jobs = await pool.query(`
            SELECT 
                jp.id, jp.title, jp.description, jp.budget as price,
                'fixed' as price_type, NULL as provider_id, jp.created_at,
                COALESCE(jp.external_provider_name, 'Service Connect') as provider_name,
                jp.location as provider_location, 0 as provider_rating,
                c.name as category_name, c.icon as category_icon, c.id as category_id,
                'job' as item_type
            FROM job_posts jp
            JOIN categories c ON jp.category_id = c.id
            WHERE jp.status = 'open' AND jp.is_public = true
            ORDER BY jp.created_at DESC
        `);
        
        const allItems = [...services.rows, ...jobs.rows];
        console.log(`📊 Seeker: ${services.rows.length} services, ${jobs.rows.length} jobs, TOTAL: ${allItems.length}`);
        
        res.json(allItems);
    } catch (error) {
        console.error('Marketplace error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== DIRECT HIRE ====================
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
        
        const providerInfo = await pool.query(
            `SELECT u.email, u.full_name as provider_name, ps.title as service_title
             FROM provider_services ps
             JOIN users u ON ps.provider_id = u.id
             WHERE ps.id = $1`,
            [service_id]
        );
        
        if (providerInfo.rows.length > 0) {
            sendEmail(providerInfo.rows[0].email, 'newHireRequest', {
                providerName: providerInfo.rows[0].provider_name,
                serviceTitle: providerInfo.rows[0].service_title,
                customerName: req.user.full_name || 'A customer',
                amount: agreed_amount
            }).catch(console.error);
        }
        
        res.json({ success: true, hire: result.rows[0] });
    } catch (error) {
        console.error('Direct hire error:', error);
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
    
    const { id } = req.params;
    const { status } = req.body;
    
    try {
        const hireResult = await pool.query(
            `SELECT dh.* FROM direct_hires dh WHERE dh.id = $1 AND dh.provider_id = $2`,
            [id, req.user.id]
        );
        
        if (hireResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Hire request not found' });
        }
        
        await pool.query(
            `UPDATE direct_hires SET status = $1 WHERE id = $2 AND provider_id = $3`,
            [status, id, req.user.id]
        );
        
        if (status === 'accepted') {
            const rateResult = await pool.query(`SELECT setting_value FROM admin_settings WHERE setting_key = 'commission_rate'`);
            const commissionRate = rateResult.rows.length > 0 ? parseFloat(rateResult.rows[0].setting_value) : 10;
            
            const commission = (hireResult.rows[0].agreed_amount * commissionRate) / 100;
            const providerEarnings = hireResult.rows[0].agreed_amount - commission;
            
            await pool.query(
                `INSERT INTO accepted_jobs (provider_id, seeker_id, service_id, agreed_amount, platform_commission, provider_earnings, commission_rate, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'accepted')`,
                [req.user.id, hireResult.rows[0].customer_id, hireResult.rows[0].service_id, hireResult.rows[0].agreed_amount, commission, providerEarnings, commissionRate]
            );
        }
        
        res.json({ success: true });
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
                    (SELECT COUNT(*) FROM direct_hires WHERE customer_id = $1) as total_direct_hires,
                    (SELECT COUNT(*) FROM accepted_jobs WHERE seeker_id = $1 AND status = 'completed') as completed_jobs`,
                [req.user.id]
            );
            res.json(result.rows[0]);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== ADMIN JOB POSTING ====================
app.post('/api/admin/jobs/create', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    
    const { title, description, budget, location, category_id, external_provider_name, external_provider_phone, external_provider_email, preferred_date } = req.body;
    
    if (!title || !description || !category_id) {
        return res.status(400).json({ success: false, message: 'Title, description, and category are required' });
    }
    
    try {
        const shareToken = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        
        const result = await pool.query(
            `INSERT INTO job_posts (seeker_id, category_id, title, description, budget, location, preferred_date,
                external_provider_name, external_provider_phone, external_provider_email, share_token, posted_by_admin, is_public, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, true, 'open')
             RETURNING *`,
            [req.user.id, category_id, title, description, budget, location, preferred_date,
             external_provider_name, external_provider_phone, external_provider_email, shareToken]
        );
        
        const shareableUrl = `${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}/job-view.html?token=${shareToken}`;
        
        res.json({ success: true, job: result.rows[0], shareable_link: shareableUrl });
    } catch (error) {
        console.error('Admin create job error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PUBLIC JOB ENDPOINTS ====================
app.get('/api/public/job/:token', async (req, res) => {
    const { token } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT jp.*, c.name as category_name, c.icon as category_icon
             FROM job_posts jp
             JOIN categories c ON jp.category_id = c.id
             WHERE jp.share_token = $1 AND jp.is_public = true`,
            [token]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }
        
        await pool.query('UPDATE job_posts SET view_count = view_count + 1 WHERE share_token = $1', [token]);
        
        res.json({ success: true, job: result.rows[0] });
    } catch (error) {
        console.error('Get public job error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/public/jobs', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT jp.id, jp.title, jp.budget, jp.location, jp.share_token, jp.view_count, jp.created_at,
                   c.name as category_name, c.icon as category_icon
            FROM job_posts jp
            JOIN categories c ON jp.category_id = c.id
            WHERE jp.is_public = true AND jp.status = 'open'
            ORDER BY jp.created_at DESC
        `);
        res.json({ success: true, jobs: result.rows });
    } catch (error) {
        console.error('Get public jobs error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ADMIN USER MANAGEMENT ====================
app.get('/api/admin/users', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') {
        return res.status(403).json({ success: false });
    }
    
    try {
        const result = await pool.query(`SELECT id, email, full_name, phone, location, user_type, is_active, is_verified, created_at FROM users ORDER BY created_at DESC`);
        const seekers = result.rows.filter(u => u.user_type === 'seeker').length;
        const providers = result.rows.filter(u => u.user_type === 'provider').length;
        res.json({ success: true, users: result.rows, total: result.rows.length, seekers, providers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/admin/users/:id', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    const { id } = req.params;
    const { full_name, phone, location, user_type, is_active, is_verified } = req.body;
    
    try {
        await pool.query(
            `UPDATE users SET full_name = $1, phone = $2, location = $3, user_type = $4, is_active = $5, is_verified = $6 WHERE id = $7`,
            [full_name, phone, location, user_type, is_active, is_verified, id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    const { id } = req.params;
    
    try {
        await pool.query('UPDATE users SET is_active = false WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/admin/users/:id/toggle-status', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    const { id } = req.params;
    
    try {
        const current = await pool.query('SELECT is_active FROM users WHERE id = $1', [id]);
        const newStatus = !current.rows[0].is_active;
        await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [newStatus, id]);
        res.json({ success: true, is_active: newStatus });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/users/:id/reset-password', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    const { id } = req.params;
    const { new_password } = req.body;
    
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ADMIN JOB MANAGEMENT ====================
app.get('/api/admin/jobs', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    
    try {
        const result = await pool.query(`
            SELECT jp.*, u.full_name as seeker_name, c.name as category_name,
                   (SELECT COUNT(*) FROM bids WHERE job_post_id = jp.id) as bid_count
            FROM job_posts jp
            LEFT JOIN users u ON jp.seeker_id = u.id
            LEFT JOIN categories c ON jp.category_id = c.id
            ORDER BY jp.created_at DESC
        `);
        res.json({ success: true, jobs: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/admin/jobs/:id', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    const { id } = req.params;
    const { title, description, budget, status } = req.body;
    
    try {
        await pool.query(
            `UPDATE job_posts SET title = $1, description = $2, budget = $3, status = $4 WHERE id = $5`,
            [title, description, budget, status, id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/admin/jobs/:id', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    const { id } = req.params;
    
    try {
        await pool.query('DELETE FROM job_posts WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== COMMISSION ENDPOINTS ====================
app.get('/api/commission/earnings', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    
    try {
        const totalResult = await pool.query(`
            SELECT COALESCE(SUM(platform_commission), 0) as total_earnings
            FROM accepted_jobs WHERE status = 'completed'
        `);
        
        const recentResult = await pool.query(`
            SELECT aj.id, aj.agreed_amount, aj.platform_commission, aj.completed_at,
                   p.full_name as provider_name, s.full_name as seeker_name,
                   COALESCE(jp.title, ps.title, 'Direct Hire') as job_title
            FROM accepted_jobs aj
            LEFT JOIN users p ON aj.provider_id = p.id
            LEFT JOIN users s ON aj.seeker_id = s.id
            LEFT JOIN job_posts jp ON aj.job_post_id = jp.id
            LEFT JOIN provider_services ps ON aj.service_id = ps.id
            WHERE aj.status = 'completed'
            ORDER BY aj.completed_at DESC
            LIMIT 20
        `);
        
        res.json({
            success: true,
            total_earnings: parseFloat(totalResult.rows[0].total_earnings) || 0,
            recent_transactions: recentResult.rows || []
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/commission/rate', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`SELECT setting_value FROM admin_settings WHERE setting_key = 'commission_rate'`);
        const rate = result.rows.length > 0 ? parseFloat(result.rows[0].setting_value) : 10;
        res.json({ success: true, commission_rate: rate });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/commission/rate', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'admin') return res.status(403).json({ success: false });
    const { rate } = req.body;
    
    try {
        await pool.query(
            `INSERT INTO admin_settings (setting_key, setting_value, updated_at) 
             VALUES ('commission_rate', $1, CURRENT_TIMESTAMP)
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1, updated_at = CURRENT_TIMESTAMP`,
            [rate]
        );
        res.json({ success: true, message: `Commission rate updated to ${rate}%` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
    const { conversation_id, receiver_id, message } = req.body;
    
    if (!message || message.trim() === '') {
        return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }
    
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
            receiverId = receiver_id;
        }
        
        const result = await pool.query(
            `INSERT INTO messages (conversation_id, sender_id, receiver_id, message, created_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             RETURNING *`,
            [conversation.id, req.user.id, receiverId, message]
        );
        
        await pool.query(
            `UPDATE conversations 
             SET last_message = $1, last_message_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
                 ${req.user.user_type === 'seeker' ? 'seeker_unread_count = seeker_unread_count + 1' : 'provider_unread_count = provider_unread_count + 1'}
             WHERE id = $2`,
            [message, conversation.id]
        );
        
        const messageWithSender = await pool.query(
            `SELECT m.*, u.full_name as sender_name, u.user_type as sender_type
             FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = $1`,
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
             FROM messages m JOIN users u ON m.sender_id = u.id
             WHERE m.conversation_id = $1 ORDER BY m.created_at ASC`,
            [conversationId]
        );
        
        await pool.query(
            `UPDATE messages SET is_read = true, read_at = CURRENT_TIMESTAMP
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
            result = await pool.query('SELECT COALESCE(SUM(seeker_unread_count), 0) as total FROM conversations WHERE seeker_id = $1', [req.user.id]);
        } else {
            result = await pool.query('SELECT COALESCE(SUM(provider_unread_count), 0) as total FROM conversations WHERE provider_id = $1', [req.user.id]);
        }
        res.json({ success: true, unread_count: parseInt(result.rows[0].total) || 0 });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/conversations/:conversationId/read', authenticateToken, async (req, res) => {
    const { conversationId } = req.params;
    
    try {
        if (req.user.user_type === 'seeker') {
            await pool.query('UPDATE conversations SET seeker_unread_count = 0 WHERE id = $1', [conversationId]);
        } else {
            await pool.query('UPDATE conversations SET provider_unread_count = 0 WHERE id = $1', [conversationId]);
        }
        
        await pool.query(
            `UPDATE messages SET is_read = true WHERE conversation_id = $1 AND receiver_id = $2 AND is_read = false`,
            [conversationId, req.user.id]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PROVIDER PROFILE ENDPOINTS ====================
app.get('/api/provider/:id/profile', async (req, res) => {
    const { id } = req.params;
    
    try {
        const userResult = await pool.query(`
            SELECT id, full_name, email, location, rating, total_reviews, 
                   bio, company_name, years_experience, response_time, verified, created_at
            FROM users 
            WHERE id = $1 AND user_type = 'provider' AND is_active = true
        `, [id]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Provider not found' });
        }
        
        const servicesResult = await pool.query(`
            SELECT ps.*, c.name as category_name, c.icon as category_icon
            FROM provider_services ps
            JOIN categories c ON ps.category_id = c.id
            WHERE ps.provider_id = $1 AND ps.is_active = true
            ORDER BY ps.created_at DESC
        `, [id]);
        
        const reviewsResult = await pool.query(`
            SELECT r.*, u.full_name as reviewer_name
            FROM reviews r
            JOIN users u ON r.reviewer_id = u.id
            WHERE r.reviewee_id = $1
            ORDER BY r.created_at DESC
            LIMIT 20
        `, [id]);
        
        const statsResult = await pool.query(`
            SELECT COUNT(DISTINCT aj.id) as completed_jobs
            FROM accepted_jobs aj
            WHERE aj.provider_id = $1 AND aj.status = 'completed'
        `, [id]);
        
        res.json({
            success: true,
            provider: userResult.rows[0],
            services: servicesResult.rows,
            reviews: reviewsResult.rows,
            stats: { completed_jobs: parseInt(statsResult.rows[0].completed_jobs) || 0 }
        });
    } catch (error) {
        console.error('Get provider profile error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/provider/profile', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can update their profile' });
    }
    
    const { bio, company_name, years_experience, response_time, location } = req.body;
    
    try {
        await pool.query(`
            UPDATE users 
            SET bio = COALESCE($1, bio),
                company_name = COALESCE($2, company_name),
                years_experience = COALESCE($3, years_experience),
                response_time = COALESCE($4, response_time),
                location = COALESCE($5, location)
            WHERE id = $6
        `, [bio, company_name, years_experience, response_time, location, req.user.id]);
        
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
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

app.get('/provider-profile.html', (req, res) => {
    const filePath = findHtmlFile('provider-profile.html');
    if (filePath) res.sendFile(filePath);
    else res.status(404).send('File not found');
});

app.get('/job-board.html', (req, res) => {
    const filePath = findHtmlFile('job-board.html');
    if (filePath) res.sendFile(filePath);
    else res.status(404).send('File not found');
});

app.get('/job-view.html', (req, res) => {
    const filePath = findHtmlFile('job-view.html');
    if (filePath) res.sendFile(filePath);
    else res.status(404).send('File not found');
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Server running on port ${PORT}`);
    console.log(`🌐 https://service-connect-7akg.onrender.com\n`);
    console.log(`📧 Email notifications: ${process.env.EMAIL_USER ? 'ENABLED' : 'DISABLED'}`);
});
