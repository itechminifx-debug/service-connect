// emailService.js
const nodemailer = require('nodemailer');

// Create transporter
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Email templates
const emailTemplates = {
    // Welcome Email
    welcome: (name, userType) => ({
        subject: `Welcome to ServiceConnect, ${name}! 🎉`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <div style="background: white; border-radius: 20px; padding: 30px;">
                    <h1 style="color: #667eea; text-align: center;">Welcome to ServiceConnect! 🎉</h1>
                    <p style="color: #333; font-size: 16px;">Dear <strong>${name}</strong>,</p>
                    <p style="color: #333; font-size: 16px;">Thank you for joining ServiceConnect! We're excited to have you on board.</p>
                    <p style="color: #333; font-size: 16px;">You've joined as a <strong>${userType === 'seeker' ? 'Customer' : 'Service Provider'}</strong>.</p>
                    ${userType === 'seeker' ? `
                        <div style="background: #f0f2f5; padding: 15px; border-radius: 10px; margin: 20px 0;">
                            <h3 style="color: #667eea;">📋 As a Customer, you can:</h3>
                            <ul style="color: #333;">
                                <li>Post jobs and get bids from professionals</li>
                                <li>Hire providers directly from the marketplace</li>
                                <li>Chat with providers before hiring</li>
                                <li>Leave reviews after job completion</li>
                            </ul>
                        </div>
                    ` : `
                        <div style="background: #f0f2f5; padding: 15px; border-radius: 10px; margin: 20px 0;">
                            <h3 style="color: #667eea;">🔧 As a Provider, you can:</h3>
                            <ul style="color: #333;">
                                <li>Browse and bid on available jobs</li>
                                <li>List your services in the marketplace</li>
                                <li>Get hired directly by customers</li>
                                <li>Build your reputation with reviews</li>
                            </ul>
                        </div>
                    `}
                    <p style="color: #333; font-size: 16px;">Get started by logging into your dashboard:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}" style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; display: inline-block;">Go to Dashboard →</a>
                    </div>
                    <p style="color: #999; font-size: 12px; text-align: center; margin-top: 30px;">If you have any questions, reply to this email. We're here to help!</p>
                </div>
            </div>
        `
    }),

    // New Bid Received
    newBid: (seekerName, jobTitle, bidAmount, providerName, jobId) => ({
        subject: `💰 New Bid on Your Job: ${jobTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: white; border-radius: 20px; padding: 30px; border: 1px solid #e2e8f0;">
                    <h1 style="color: #10b981; text-align: center;">💰 New Bid Received!</h1>
                    <p style="color: #333; font-size: 16px;">Dear <strong>${seekerName}</strong>,</p>
                    <p style="color: #333; font-size: 16px;">A new bid has been placed on your job!</p>
                    <div style="background: #f0fdf4; padding: 20px; border-radius: 15px; margin: 20px 0;">
                        <h3 style="color: #10b981; margin-bottom: 15px;">📋 Job Details</h3>
                        <p><strong>Job:</strong> ${jobTitle}</p>
                        <p><strong>Provider:</strong> ${providerName}</p>
                        <p><strong>Bid Amount:</strong> GHS ${bidAmount}</p>
                    </div>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}/seeker-dashboard.html" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; display: inline-block;">View Bids →</a>
                    </div>
                </div>
            </div>
        `
    }),

    // Bid Accepted
    bidAccepted: (providerName, jobTitle, amount, seekerName) => ({
        subject: `✅ Your Bid Has Been Accepted! - ${jobTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: white; border-radius: 20px; padding: 30px; border: 1px solid #e2e8f0;">
                    <h1 style="color: #10b981; text-align: center;">✅ Congratulations! Your Bid Was Accepted</h1>
                    <p style="color: #333; font-size: 16px;">Dear <strong>${providerName}</strong>,</p>
                    <p style="color: #333; font-size: 16px;">Great news! Your bid has been accepted by the customer.</p>
                    <div style="background: #f0fdf4; padding: 20px; border-radius: 15px; margin: 20px 0;">
                        <h3 style="color: #10b981; margin-bottom: 15px;">📋 Job Details</h3>
                        <p><strong>Job:</strong> ${jobTitle}</p>
                        <p><strong>Customer:</strong> ${seekerName}</p>
                        <p><strong>Agreed Amount:</strong> GHS ${amount}</p>
                    </div>
                    <p style="color: #333;">Please contact the customer to discuss the job details and schedule.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}/provider-dashboard.html" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; display: inline-block;">Go to My Jobs →</a>
                    </div>
                </div>
            </div>
        `
    }),

    // Job Completed
    jobCompleted: (seekerName, jobTitle, providerName, amount) => ({
        subject: `✅ Job Completed: ${jobTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: white; border-radius: 20px; padding: 30px; border: 1px solid #e2e8f0;">
                    <h1 style="color: #10b981; text-align: center;">✅ Job Completed Successfully!</h1>
                    <p style="color: #333; font-size: 16px;">Dear <strong>${seekerName}</strong>,</p>
                    <p style="color: #333; font-size: 16px;">Your job has been marked as complete by ${providerName}.</p>
                    <div style="background: #f0fdf4; padding: 20px; border-radius: 15px; margin: 20px 0;">
                        <h3 style="color: #10b981; margin-bottom: 15px;">📋 Job Summary</h3>
                        <p><strong>Job:</strong> ${jobTitle}</p>
                        <p><strong>Provider:</strong> ${providerName}</p>
                        <p><strong>Amount Paid:</strong> GHS ${amount}</p>
                    </div>
                    <p style="color: #333;">Please take a moment to rate your experience with the provider.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}/seeker-dashboard.html" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; display: inline-block;">Leave a Review →</a>
                    </div>
                </div>
            </div>
        `
    }),

    // New Hire Request
    newHireRequest: (providerName, serviceTitle, customerName, amount) => ({
        subject: `📞 New Hire Request: ${serviceTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: white; border-radius: 20px; padding: 30px; border: 1px solid #e2e8f0;">
                    <h1 style="color: #f59e0b; text-align: center;">📞 New Hire Request!</h1>
                    <p style="color: #333; font-size: 16px;">Dear <strong>${providerName}</strong>,</p>
                    <p style="color: #333; font-size: 16px;">A customer wants to hire you directly!</p>
                    <div style="background: #fef3c7; padding: 20px; border-radius: 15px; margin: 20px 0;">
                        <h3 style="color: #f59e0b; margin-bottom: 15px;">📋 Request Details</h3>
                        <p><strong>Service:</strong> ${serviceTitle}</p>
                        <p><strong>Customer:</strong> ${customerName}</p>
                        <p><strong>Offered Amount:</strong> GHS ${amount}</p>
                    </div>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'https://service-connect-7akg.onrender.com'}/provider-dashboard.html" style="background: #f59e0b; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; display: inline-block;">View Request →</a>
                    </div>
                </div>
            </div>
        `
    })
};

// Send email function
async function sendEmail(to, type, data) {
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
        
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent to ${to}: ${type} - ${info.messageId}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send email to ${to}:`, error.message);
        return false;
    }
}

module.exports = { sendEmail };
