import * as authService from '../src/services/auth.service.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testLogin() {
    try {
        const result = await authService.login({ email: 'trial@gmail.com', password: '123456' }, '127.0.0.1', 'Desktop');
        console.log('LOGIN SUCCESSFUL! User details:', {
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            role: result.user.role,
            clinics: result.clinics
        });
    } catch (e) {
        console.error('LOGIN FAILED:', e.message);
    }
}

testLogin()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
