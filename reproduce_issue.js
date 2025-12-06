
try {
    const { Chess } = require('./chess.js'); // Assuming node environment or similar
    const chess = new Chess();

    // Setup a position close to promotion
    chess.load('8/P7/8/8/8/8/8/k6K w - - 0 1');

    // Try standard promotion
    const move1 = chess.move('a8=Q');
    console.log('a8=Q result:', move1 ? 'Success' : 'Fail');

    chess.load('8/P7/8/8/8/8/8/k6K w - - 0 1');
    // Try =T promotion
    try {
        const move2 = chess.move('a8=T', { sloppy: true });
        console.log('a8=T result:', move2 ? 'Success' : 'Fail');
    } catch (e) {
        console.log('a8=T threw error:', e.message);
    }

} catch (e) {
    // If require fails (browser context), just mock standard behavior expectation
    console.log("Environment doesn't support require, skipping execution.");
}
