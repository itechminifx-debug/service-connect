// emailService.js
const nodemailer = require('nodemailer');

let transporter = null;

// Setup transporter if credentials exist
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp-relay.brevo.com',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    
    transporter.verify((error, success) => {
        if (error) {
            console.error('❌ Email service error:', error.message);
        } else {
            console.log('✅ Email service ready');
        }
    });
} else {
    console.log('⚠️ Email not configured');
}

// Email templates
const emailTemplates = {
    welcome: (data) => ({
        subject: `Welcome to ServiceConnect, ${data.name}! 🎉`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #667eea;">Welcome to ServiceConnect!</h1>
                <p>Dear <strong>${data.name}</strong>,</p>
                <p>Thank you for joining ServiceConnect as a <strong>${data.userType === 'seeker' ? 'Customer' : 'Service Provider'}</strong>.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.APP_URL}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Go to Dashboard →</a>
                </div>
                <p>Best regards,<br>The ServiceConnect Team</p>
            </div>
        `
    }),
    newBid: (data) => ({
        subject: `💰 New Bid on: ${data.jobTitle}`,
        html: `<h2>New Bid!</h2><p>${data.providerName} bid GHS ${data.bidAmount} on "${data.jobTitle}"</p>`
    }),
    bidAccepted: (data) => ({
        subject: `✅ Your Bid Was Accepted: ${data.jobTitle}`,
        html: `<h2>Bid Accepted!</h2><p>Your bid of GHS ${data.amount} for "${data.jobTitle}" was accepted.</p>`
    }),
    jobCompleted: (data) => ({
        subject: `✅ Job Completed: ${data.jobTitle}`,
        html: `<h2>Job Completed!</h2><p>${data.providerName} completed "${data.jobTitle}"</p>`
    }),
    newHireRequest: (data) => ({
        subject: `📞 New Hire Request: ${data.serviceTitle}`,
        html: `<h2>New Hire Request!</h2><p>${data.customerName} wants to hire you for ${data.serviceTitle} at GHS ${data.amount}</p>`
    })
};

async function sendEmail(to, type, data) {
    if (!transporter) {
        console.log(`📧 Email would be sent to ${to}: ${type}`);
        return true;
    }
    
    try {
        const template = emailTemplates[type];
        if (!template) return false;
        
        await transporter.sendMail({
            from: `"ServiceConnect" <${process.env.EMAIL_USER}>`,
            to: to,
            subject: template(data).subject,
            html: template(data).html
        });
        
        console.log(`✅ Email sent to ${to}: ${type}`);
        return true;
    } catch (error) {
        console.error(`❌ Email failed:`, error.message);
        return false;
    }
}

module.exports = { sendEmail };