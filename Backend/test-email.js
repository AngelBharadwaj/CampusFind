import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

console.log('Testing email configuration...');
console.log('Email:', process.env.EMAIL_USER);
console.log('Password length:', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 'NOT SET');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.verify(function(error, success) {
  if (error) {
    console.log('❌ Email test FAILED:', error.message);
    console.log('\n🔧 TROUBLESHOOTING STEPS:');
    console.log('1. Go to: https://myaccount.google.com/apppasswords');
    console.log('2. Make sure 2FA is enabled on CampusFind25@gmail.com');
    console.log('3. Delete ALL existing app passwords');
    console.log('4. Generate a NEW app password for "Mail"');
    console.log('5. Update .env file with the NEW password');
    console.log('6. Restart the server');
  } else {
    console.log('✅ Email test SUCCESS!');
  }
});