// emailService.js
let nodemailer;
try {
    nodemailer = require('nodemailer');
} catch (error) {
    console.log('⚠️ nodemailer not installed. Email features disabled.');
    nodemailer = null;
}

// Create transporter only if nodemailer is available
let transporter = null;
if (nodemailer && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    
    // Verify connection
    transporter.verify((error, success) => {
        if (error) {
            console.error('❌ Email service error:', error.message);
        } else {
            console.log('✅ Email service ready');
        }
    });
} else {
    console.log('⚠️ Email not configured. Set EMAIL_USER and EMAIL_PASS to enable.');
}

// Email templates
const emailTemplates = {
    welcome: (data) => ({
        subject: `Welcome to ServiceConnect, ${data.name}! 🎉`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: white; border-radius: 20px; padding: 30px;">
                    <h1 style="color: #667eea;">Welcome to ServiceConnect! 🎉</h1>
                    <p>Dear <strong>${data.name}</strong>,</p>
                    <p>Thank you for joining ServiceConnect! You've joined as a <strong>${data.userType === 'seeker' ? 'Customer' : 'Service Provider'}</strong>.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px;">Go to Dashboard →</a>
                    </div>
                </div>
            </div>
        `
    }),

    newBid: (data) => ({
        subject: `💰 New Bid on Your Job: ${data.jobTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: white; border-radius: 20px; padding: 30px;">
                    <h1 style="color: #10b981;">💰 New Bid Received!</h1>
                    <p>Dear <strong>${data.seekerName}</strong>,</p>
                    <p>A new bid has been placed on your job <strong>${data.jobTitle}</strong> for <strong>GHS ${data.bidAmount}</strong> by ${data.providerName}.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}/seeker-dashboard.html" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px;">View Bids →</a>
                    </div>
                </div>
            </div>
        `
    }),

    bidAccepted: (data) => ({
        subject: `✅ Your Bid Has Been Accepted! - ${data.jobTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: white; border-radius: 20px; padding: 30px;">
                    <h1 style="color: #10b981;">✅ Congratulations! Your Bid Was Accepted</h1>
                    <p>Dear <strong>${data.providerName}</strong>,</p>
                    <p>Your bid of <strong>GHS ${data.amount}</strong> for <strong>${data.jobTitle}</strong> has been accepted by ${data.seekerName}.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}/provider-dashboard.html" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px;">Go to My Jobs →</a>
                    </div>
                </div>
            </div>
        `
    }),

    jobCompleted: (data) => ({
        subject: `✅ Job Completed: ${data.jobTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: white; border-radius: 20px; padding: 30px;">
                    <h1 style="color: #10b981;">✅ Job Completed Successfully!</h1>
                    <p>Dear <strong>${data.seekerName}</strong>,</p>
                    <p>Your job <strong>${data.jobTitle}</strong> has been marked as complete by ${data.providerName}.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}/seeker-dashboard.html" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px;">Leave a Review →</a>
                    </div>
                </div>
            </div>
        `
    }),

    newHireRequest: (data) => ({
        subject: `📞 New Hire Request: ${data.serviceTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: white; border-radius: 20px; padding: 30px;">
                    <h1 style="color: #f59e0b;">📞 New Hire Request!</h1>
                    <p>Dear <strong>${data.providerName}</strong>,</p>
                    <p>${data.customerName} wants to hire you for <strong>${data.serviceTitle}</strong> for <strong>GHS ${data.amount}</strong>.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}/provider-dashboard.html" style="background: #f59e0b; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px;">View Request →</a>
                    </div>
                </div>
            </div>
        `
    })
};

// Send email function
async function sendEmail(to, type, data) {
    // Skip if email not configured
    if (!transporter) {
        console.log('⚠️ Email not configured. Skipping email to:', to);
        return false;
    }
    
    try {
        const template = emailTemplates[type];
        if (!template) {
            console.log(`No template found for type: ${type}`);
            return false;
        }
        
        const emailContent = template(data);
        
        const mailOptions = {
            from: `"ServiceConnect" <${process.env.EMAIL_USER}>`,
            to: to,
            subject: emailContent.subject,
            html: emailContent.html
        };
        
        await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent to ${to}: ${type}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send email to ${to}:`, error.message);
        return false;
    }
}

module.exports = { sendEmail };