import { getUnreadNotificationsCount } from './src/services/department.service.js';

async function testUnread() {
    try {
        console.log("Testing getUnreadNotificationsCount...");
        const count = await getUnreadNotificationsCount(1);
        console.log("SUCCESS! Count:", count);
    } catch (err: any) {
        console.error("EXACT ERROR:", err);
    }
}

testUnread();
