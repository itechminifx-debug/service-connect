const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
    } else {
        console.log('✅ PostgreSQL connected successfully');
    }
});

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
        return res.status(400).json({ success: false, message: 'Please provide all required fields' });
    }
    
    if (!['provider', 'seeker'].includes(user_type)) {
        return res.status(400).json({ success: false, message: 'Invalid user type' });
    }
    
    try {
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'User already exists with this email' });
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
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }
    
    try {
        const result = await pool.query(
            'SELECT id, email, password_hash, full_name, user_type, is_active FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        
        if (!user.is_active) {
            return res.status(401).json({ success: false, message: 'Account is deactivated. Please contact support.' });
        }
        
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
            'SELECT id, email, full_name, phone, location, user_type, rating, total_reviews, is_verified, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==================== CATEGORIES API ====================
app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM categories WHERE is_active = true ORDER BY display_order'
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== PROVIDER SERVICES API ====================
app.get('/api/provider/services', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can access this' });
    }
    
    try {
        const result = await pool.query(
            `SELECT ps.*, c.name as category_name, c.icon as category_icon
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
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can access this' });
    }
    
    const { category_id, title, description, price, price_type, experience_years } = req.body;
    
    if (!category_id || !title) {
        return res.status(400).json({ success: false, message: 'Category and title are required' });
    }
    
    try {
        const result = await pool.query(
            `INSERT INTO provider_services (provider_id, category_id, title, description, price, price_type, experience_years)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [req.user.id, category_id, title, description, price, price_type, experience_years || 0]
        );
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/provider/services/:id', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can access this' });
    }
    
    try {
        await pool.query(
            'DELETE FROM provider_services WHERE id = $1 AND provider_id = $2',
            [req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== JOB POSTS API ====================
app.get('/api/jobs', authenticateToken, async (req, res) => {
    const { category, location } = req.query;
    
    try {
        let query = `
            SELECT jp.*, 
                   u.full_name as seeker_name, 
                   u.location as seeker_location,
                   c.name as category_name,
                   c.icon as category_icon
            FROM job_posts jp
            JOIN users u ON jp.seeker_id = u.id
            JOIN categories c ON jp.category_id = c.id
            WHERE jp.status = 'open'
        `;
        let params = [];
        let paramCount = 1;
        
        if (category) {
            query += ` AND jp.category_id = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        
        if (location) {
            query += ` AND jp.location ILIKE $${paramCount}`;
            params.push(`%${location}%`);
            paramCount++;
        }
        
        query += ` ORDER BY jp.created_at DESC LIMIT 50`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/jobs/my', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'seeker') {
        return res.status(403).json({ success: false, message: 'Only seekers can access this' });
    }
    
    try {
        const result = await pool.query(
            `SELECT jp.*, c.name as category_name
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
            `INSERT INTO job_posts (seeker_id, category_id, title, description, budget, location, preferred_date, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
             RETURNING *`,
            [req.user.id, category_id, title, description, budget, location, preferred_date]
        );
        res.json({ success: true, job: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/jobs/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE job_posts SET views = views + 1 WHERE id = $1', [req.params.id]);
        
        const result = await pool.query(
            `SELECT jp.*, 
                    u.full_name as seeker_name, 
                    u.location as seeker_location,
                    u.rating as seeker_rating,
                    c.name as category_name,
                    c.icon as category_icon
             FROM job_posts jp
             JOIN users u ON jp.seeker_id = u.id
             JOIN categories c ON jp.category_id = c.id
             WHERE jp.id = $1`,
            [req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== BIDS API ====================
app.get('/api/jobs/:jobId/bids', authenticateToken, async (req, res) => {
    try {
        const jobCheck = await pool.query(
            'SELECT seeker_id FROM job_posts WHERE id = $1',
            [req.params.jobId]
        );
        
        if (jobCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }
        
        if (jobCheck.rows[0].seeker_id !== req.user.id && req.user.user_type !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        
        const result = await pool.query(
            `SELECT b.*, 
                    u.full_name as provider_name, 
                    u.rating as provider_rating,
                    u.phone as provider_phone
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

app.post('/api/jobs/:jobId/bids', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can place bids' });
    }
    
    const { amount, message, estimated_days } = req.body;
    const jobId = req.params.jobId;
    
    if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    
    try {
        const jobCheck = await pool.query(
            'SELECT id, status FROM job_posts WHERE id = $1',
            [jobId]
        );
        
        if (jobCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }
        
        if (jobCheck.rows[0].status !== 'open') {
            return res.status(400).json({ success: false, message: 'This job is no longer accepting bids' });
        }
        
        const existingBid = await pool.query(
            'SELECT id FROM bids WHERE job_post_id = $1 AND provider_id = $2',
            [jobId, req.user.id]
        );
        
        if (existingBid.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'You have already placed a bid on this job' });
        }
        
        const result = await pool.query(
            `INSERT INTO bids (job_post_id, provider_id, amount, message, estimated_days, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             RETURNING *`,
            [jobId, req.user.id, amount, message, estimated_days || 1]
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
        
        if (bidResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Bid not found' });
        }
        
        const bid = bidResult.rows[0];
        
        if (bid.seeker_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to accept this bid' });
        }
        
        if (bid.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'This bid can no longer be accepted' });
        }
        
        await pool.query('UPDATE bids SET status = $1 WHERE id = $2', ['accepted', req.params.bidId]);
        await pool.query('UPDATE job_posts SET status = $1 WHERE id = $2', ['assigned', bid.job_id]);
        
        const commission = bid.amount * 0.10;
        const providerEarnings = bid.amount - commission;
        
        const acceptedJob = await pool.query(
            `INSERT INTO accepted_jobs (job_post_id, provider_id, seeker_id, bid_id, agreed_amount, platform_commission, provider_earnings, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'accepted')
             RETURNING *`,
            [bid.job_id, bid.provider_id, req.user.id, req.params.bidId, bid.amount, commission, providerEarnings]
        );
        
        res.json({ success: true, accepted_job: acceptedJob.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== PROVIDER BIDS API ====================
app.get('/api/provider/bids', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can access this' });
    }
    
    try {
        const result = await pool.query(
            `SELECT b.*, jp.title as job_title, jp.budget as job_budget, jp.status as job_status
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

// ==================== PROVIDER JOBS API ====================
app.get('/api/provider/jobs', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can access this' });
    }
    
    try {
        const result = await pool.query(
            `SELECT aj.*, jp.title as job_title, jp.description as job_description, jp.budget as job_budget,
                    u.full_name as seeker_name, u.phone as seeker_phone, u.location as seeker_location
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

// ==================== UPDATE JOB STATUS (PROVIDER) ====================
app.put('/api/provider/jobs/:jobId/status', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can access this' });
    }
    
    const { status } = req.body;
    const validStatuses = ['in_progress', 'completed', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    
    try {
        const result = await pool.query(
            `UPDATE accepted_jobs 
             SET status = $1, 
                 completed_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
             WHERE id = $2 AND provider_id = $3
             RETURNING *`,
            [status, req.params.jobId, req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }
        
        if (status === 'completed') {
            const acceptedJob = result.rows[0];
            await pool.query('UPDATE job_posts SET status = $1 WHERE id = $2', ['completed', acceptedJob.job_post_id]);
        }
        
        res.json({ success: true, job: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== DIRECT HIRE API ====================
// Get all available services for marketplace
app.get('/api/services/marketplace', authenticateToken, async (req, res) => {
    const { category, location, min_price, max_price, search } = req.query;
    
    try {
        let query = `
            SELECT ps.*, 
                   u.full_name as provider_name, 
                   u.location as provider_location,
                   u.rating as provider_rating,
                   u.total_reviews as provider_reviews,
                   c.name as category_name,
                   c.icon as category_icon
            FROM provider_services ps
            JOIN users u ON ps.provider_id = u.id
            JOIN categories c ON ps.category_id = c.id
            WHERE ps.is_active = true AND u.is_active = true
        `;
        let params = [];
        let paramCount = 1;
        
        if (category) {
            query += ` AND ps.category_id = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        
        if (location) {
            query += ` AND u.location ILIKE $${paramCount}`;
            params.push(`%${location}%`);
            paramCount++;
        }
        
        if (min_price) {
            query += ` AND ps.price >= $${paramCount}`;
            params.push(min_price);
            paramCount++;
        }
        
        if (max_price) {
            query += ` AND ps.price <= $${paramCount}`;
            params.push(max_price);
            paramCount++;
        }
        
        if (search) {
            query += ` AND (ps.title ILIKE $${paramCount} OR ps.description ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }
        
        query += ` ORDER BY u.rating DESC, ps.created_at DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Marketplace error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Direct hire - customer hires provider
app.post('/api/direct-hire', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'seeker') {
        return res.status(403).json({ success: false, message: 'Only customers can hire providers' });
    }
    
    const { service_id, provider_id, message, agreed_amount } = req.body;
    
    if (!service_id || !provider_id) {
        return res.status(400).json({ success: false, message: 'Service and provider are required' });
    }
    
    try {
        const serviceCheck = await pool.query(
            `SELECT ps.*, u.full_name as provider_name 
             FROM provider_services ps
             JOIN users u ON ps.provider_id = u.id
             WHERE ps.id = $1 AND ps.provider_id = $2`,
            [service_id, provider_id]
        );
        
        if (serviceCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }
        
        const service = serviceCheck.rows[0];
        const finalAmount = agreed_amount || service.price || 0;
        
        const result = await pool.query(
            `INSERT INTO direct_hires (customer_id, provider_id, service_id, message, agreed_amount, status, created_at)
             VALUES ($1, $2, $3, $4, $5, 'pending', CURRENT_TIMESTAMP)
             RETURNING *`,
            [req.user.id, provider_id, service_id, message, finalAmount]
        );
        
        res.json({ success: true, hire: result.rows[0] });
    } catch (error) {
        console.error('Direct hire error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get provider's hire requests
app.get('/api/provider/hire-requests', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can access this' });
    }
    
    try {
        const result = await pool.query(
            `SELECT dh.*, 
                    u.full_name as customer_name, 
                    u.phone as customer_phone,
                    ps.title as service_title
             FROM direct_hires dh
             JOIN users u ON dh.customer_id = u.id
             JOIN provider_services ps ON dh.service_id = ps.id
             WHERE dh.provider_id = $1 AND dh.status = 'pending'
             ORDER BY dh.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get hire requests error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Accept or reject direct hire request (FIXED - no updated_at column)
app.put('/api/direct-hire/:id/respond', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can respond' });
    }
    
    const { status } = req.body;
    const hireId = parseInt(req.params.id);
    
    if (!status || (status !== 'accepted' && status !== 'rejected')) {
        return res.status(400).json({ success: false, message: 'Invalid status. Must be "accepted" or "rejected"' });
    }
    
    try {
        const hireResult = await pool.query(
            `SELECT * FROM direct_hires WHERE id = $1 AND provider_id = $2`,
            [hireId, req.user.id]
        );
        
        if (hireResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Hire request not found' });
        }
        
        const hire = hireResult.rows[0];
        
        if (hire.status !== 'pending') {
            return res.status(400).json({ success: false, message: `This request has already been ${hire.status}` });
        }
        
        // Update the hire request status
        await pool.query(
            `UPDATE direct_hires SET status = $1 WHERE id = $2 AND provider_id = $3`,
            [status, hireId, req.user.id]
        );
        
        // If accepted, create a job post automatically
        if (status === 'accepted') {
            const serviceResult = await pool.query(
                `SELECT ps.*, c.id as category_id 
                 FROM provider_services ps
                 JOIN categories c ON ps.category_id = c.id
                 WHERE ps.id = $1`,
                [hire.service_id]
            );
            
            if (serviceResult.rows.length > 0) {
                const service = serviceResult.rows[0];
                
                const jobResult = await pool.query(
                    `INSERT INTO job_posts (seeker_id, category_id, title, description, budget, status, created_at)
                     VALUES ($1, $2, $3, $4, $5, 'assigned', CURRENT_TIMESTAMP)
                     RETURNING *`,
                    [hire.customer_id, service.category_id, `Hired: ${service.title}`, `Direct hire for service: ${service.title}`, hire.agreed_amount]
                );
                
                await pool.query(
                    `INSERT INTO accepted_jobs (job_post_id, provider_id, seeker_id, agreed_amount, platform_commission, provider_earnings, status, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, 'accepted', CURRENT_TIMESTAMP)`,
                    [jobResult.rows[0].id, req.user.id, hire.customer_id, hire.agreed_amount, hire.agreed_amount * 0.10, hire.agreed_amount * 0.90]
                );
            }
        }
        
        res.json({ success: true, message: `Hire request ${status} successfully` });
    } catch (error) {
        console.error('Respond to hire error:', error);
        res.status(500).json({ success: false, message: error.message });
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
                    (SELECT COUNT(*) FROM bids WHERE provider_id = $1) as total_bids
                `,
                [req.user.id]
            );
            res.json(result.rows[0]);
        } else if (req.user.user_type === 'seeker') {
            const result = await pool.query(
                `SELECT 
                    (SELECT COUNT(*) FROM job_posts WHERE seeker_id = $1) as total_jobs_posted,
                    (SELECT COUNT(*) FROM bids b JOIN job_posts jp ON b.job_post_id = jp.id WHERE jp.seeker_id = $1) as total_bids_received,
                    (SELECT COUNT(*) FROM job_posts WHERE seeker_id = $1 AND status = 'open') as open_jobs,
                    (SELECT COUNT(*) FROM job_posts WHERE seeker_id = $1 AND status = 'completed') as completed_jobs
                `,
                [req.user.id]
            );
            res.json(result.rows[0]);
        } else {
            const result = await pool.query(
                `SELECT 
                    (SELECT COUNT(*) FROM users WHERE user_type = 'provider') as total_providers,
                    (SELECT COUNT(*) FROM users WHERE user_type = 'seeker') as total_seekers,
                    (SELECT COUNT(*) FROM job_posts) as total_jobs,
                    (SELECT COUNT(*) FROM accepted_jobs WHERE status = 'completed') as completed_jobs,
                    (SELECT COALESCE(SUM(platform_commission), 0) FROM accepted_jobs) as total_commission
                `
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

// ==================== SERVE FRONTEND ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.get('/:page.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', `${req.params.page}.html`));
});

// Get seeker's direct hires
app.get('/api/seeker/direct-hires', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'seeker') {
        return res.status(403).json({ success: false, message: 'Only seekers can access this' });
    }
    
    try {
        const result = await pool.query(
            `SELECT dh.*, 
                    u.full_name as provider_name, 
                    u.rating as provider_rating,
                    ps.title as service_title
             FROM direct_hires dh
             JOIN users u ON dh.provider_id = u.id
             JOIN provider_services ps ON dh.service_id = ps.id
             WHERE dh.customer_id = $1
             ORDER BY dh.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get seeker direct hires error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ PROVIDER DASHBOARD ENDPOINTS ============

// 1. Get all available jobs (for providers to bid on)
app.get('/api/jobs', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT j.*, c.name as category_name, c.icon as category_icon,
                    (SELECT COUNT(*) FROM bids WHERE job_id = j.id) as bid_count
             FROM jobs j
             JOIN categories c ON j.category_id = c.id
             WHERE j.status = 'open'
             ORDER BY j.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get jobs error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Place a bid on a job
app.post('/api/jobs/:jobId/bids', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false, message: 'Only providers can place bids' });
    }
    
    const { jobId } = req.params;
    const { amount, estimated_days, message } = req.body;
    
    try {
        // Check if already bid on this job
        const existingBid = await pool.query(
            'SELECT id FROM bids WHERE job_id = $1 AND provider_id = $2',
            [jobId, req.user.id]
        );
        
        if (existingBid.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'You already bid on this job' });
        }
        
        const result = await pool.query(
            `INSERT INTO bids (job_id, provider_id, amount, estimated_days, message)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [jobId, req.user.id, amount, estimated_days, message || null]
        );
        
        res.json({ success: true, bidId: result.rows[0].id });
    } catch (error) {
        console.error('Place bid error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Get provider's bids
app.get('/api/provider/bids', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json([]);
    }
    
    try {
        const result = await pool.query(
            `SELECT b.*, j.title as job_title, j.budget as job_budget
             FROM bids b
             JOIN jobs j ON b.job_id = j.id
             WHERE b.provider_id = $1
             ORDER BY b.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get provider bids error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4. Accept a bid (seeker accepts provider's bid)
app.put('/api/bids/:bidId/accept', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'seeker') {
        return res.status(403).json({ success: false, message: 'Only seekers can accept bids' });
    }
    
    const { bidId } = req.params;
    
    try {
        // Get bid details
        const bidResult = await pool.query(
            `SELECT b.*, j.seeker_id, j.id as job_id
             FROM bids b
             JOIN jobs j ON b.job_id = j.id
             WHERE b.id = $1`,
            [bidId]
        );
        
        if (bidResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Bid not found' });
        }
        
        const bid = bidResult.rows[0];
        
        if (bid.seeker_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not your job' });
        }
        
        // Update bid status
        await pool.query(
            'UPDATE bids SET status = $1 WHERE id = $2',
            ['accepted', bidId]
        );
        
        // Update job status to assigned
        await pool.query(
            'UPDATE jobs SET status = $1, assigned_provider_id = $2 WHERE id = $3',
            ['assigned', bid.provider_id, bid.job_id]
        );
        
        // Reject other bids on this job
        await pool.query(
            `UPDATE bids SET status = 'rejected' 
             WHERE job_id = $1 AND id != $2 AND status = 'pending'`,
            [bid.job_id, bidId]
        );
        
        res.json({ success: true, message: 'Bid accepted!' });
    } catch (error) {
        console.error('Accept bid error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. Get provider's accepted jobs (My Jobs tab)
app.get('/api/provider/jobs', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json([]);
    }
    
    try {
        const result = await pool.query(
            `SELECT j.id, j.title as job_title, j.status as job_status,
                    b.amount as agreed_amount, b.estimated_days,
                    u.full_name as seeker_name, u.phone as seeker_phone,
                    b.status as bid_status
             FROM bids b
             JOIN jobs j ON b.job_id = j.id
             JOIN users u ON j.seeker_id = u.id
             WHERE b.provider_id = $1 AND b.status = 'accepted'
             ORDER BY j.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get provider jobs error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 6. Mark job as complete (provider)
app.put('/api/provider/jobs/:jobId/status', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false });
    }
    
    const { jobId } = req.params;
    const { status } = req.body;
    
    try {
        // Verify this job belongs to the provider
        const verifyResult = await pool.query(
            `SELECT j.id FROM jobs j
             JOIN bids b ON b.job_id = j.id
             WHERE j.id = $1 AND b.provider_id = $2 AND b.status = 'accepted'`,
            [jobId, req.user.id]
        );
        
        if (verifyResult.rows.length === 0) {
            return res.status(403).json({ success: false, message: 'Job not found or not assigned to you' });
        }
        
        await pool.query(
            'UPDATE jobs SET status = $1 WHERE id = $2',
            [status === 'completed' ? 'completed' : 'assigned', jobId]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Update job status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 7. Get provider's services
app.get('/api/provider/services', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json([]);
    }
    
    try {
        const result = await pool.query(
            `SELECT ps.*, c.name as category_name, c.icon as category_icon
             FROM provider_services ps
             JOIN categories c ON ps.category_id = c.id
             WHERE ps.provider_id = $1
             ORDER BY ps.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get provider services error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8. Add provider service
app.post('/api/provider/services', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false });
    }
    
    const { category_id, title, description, price, price_type, experience_years } = req.body;
    
    try {
        const result = await pool.query(
            `INSERT INTO provider_services (provider_id, category_id, title, description, price, price_type, experience_years)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [req.user.id, category_id, title, description, price, price_type || 'fixed', experience_years || null]
        );
        
        res.json({ success: true, serviceId: result.rows[0].id });
    } catch (error) {
        console.error('Add service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 9. Delete provider service
app.delete('/api/provider/services/:serviceId', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false });
    }
    
    const { serviceId } = req.params;
    
    try {
        await pool.query(
            'DELETE FROM provider_services WHERE id = $1 AND provider_id = $2',
            [serviceId, req.user.id]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Delete service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 10. Get hire requests for provider (direct hires)
app.get('/api/provider/hire-requests', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json([]);
    }
    
    try {
        const result = await pool.query(
            `SELECT dh.*, 
                    u.full_name as customer_name, 
                    u.phone as customer_phone,
                    ps.title as service_title
             FROM direct_hires dh
             JOIN users u ON dh.customer_id = u.id
             JOIN provider_services ps ON dh.service_id = ps.id
             WHERE dh.provider_id = $1 AND dh.status = 'pending'
             ORDER BY dh.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get hire requests error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 11. Respond to direct hire request
app.put('/api/direct-hire/:hireId/respond', authenticateToken, async (req, res) => {
    if (req.user.user_type !== 'provider') {
        return res.status(403).json({ success: false });
    }
    
    const { hireId } = req.params;
    const { status } = req.body;
    
    try {
        await pool.query(
            'UPDATE direct_hires SET status = $1 WHERE id = $2 AND provider_id = $3',
            [status, hireId, req.user.id]
        );
        
        // If accepted, create a job record? Or track separately
        if (status === 'accepted') {
            // Optionally create a job record or tracking entry
            console.log(`Direct hire ${hireId} accepted by provider ${req.user.id}`);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Respond to hire error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 12. Get dashboard stats
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        let stats = {};
        
        if (req.user.user_type === 'provider') {
            // Provider stats
            const jobsResult = await pool.query(
                `SELECT COUNT(*) as total_jobs,
                        SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
                        SUM(b.amount) as total_earnings
                 FROM bids b
                 JOIN jobs j ON b.job_id = j.id
                 WHERE b.provider_id = $1 AND b.status = 'accepted'`,
                [req.user.id]
            );
            
            const bidsResult = await pool.query(
                'SELECT COUNT(*) as total_bids FROM bids WHERE provider_id = $1',
                [req.user.id]
            );
            
            stats = { ...jobsResult.rows[0], total_bids: parseInt(bidsResult.rows[0].total_bids) };
        } else {
            // Seeker stats
            const jobsResult = await pool.query(
                'SELECT COUNT(*) as total_jobs FROM jobs WHERE seeker_id = $1',
                [req.user.id]
            );
            
            const completedResult = await pool.query(
                'SELECT COUNT(*) as completed_jobs FROM jobs WHERE seeker_id = $1 AND status = $2',
                [req.user.id, 'completed']
            );
            
            const bidsResult = await pool.query(
                `SELECT COUNT(*) as total_bids_received
                 FROM bids b
                 JOIN jobs j ON b.job_id = j.id
                 WHERE j.seeker_id = $1`,
                [req.user.id]
            );
            
            stats = {
                total_jobs: parseInt(jobsResult.rows[0].total_jobs),
                completed_jobs: parseInt(completedResult.rows[0].completed_jobs),
                total_bids_received: parseInt(bidsResult.rows[0].total_bids_received)
            };
        }
        
        res.json(stats);
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║     🔗 SERVICE CONNECT PLATFORM                                   ║
║     Connecting Service Providers with Customers                   ║
║                                                                   ║
║     ✅ Server running on http://localhost:${PORT}                   ║
║     ✅ Database connected                                          ║
║     ✅ Direct Hire API Ready                                       ║
║                                                                   ║
║     🔐 Test Credentials:                                          ║
║     Register as Provider or Seeker                                ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `);
});