const fs = require('fs');
const vm = require('vm');
const path = require('path');

const chessCode = fs.readFileSync(path.join(__dirname, 'chess.js'), 'utf8');
const sandbox = {};
vm.runInNewContext(chessCode, sandbox);
const Chess = sandbox.Chess;
if (!Chess) { console.error('Chess not found in sandbox'); process.exit(1); }

const moves = [
  'e4','d5','d3','e5','Nf3','dxe4','dxe4','Qxd1+','Kxd1','Nf6','Bg5','Be7','Nxe5','h6','Bxf6','Bxf6','Nd3','O-O','Be2','Re8','Nc5','b6','Bc4','bxc5','Kc1'
];

const game = new Chess();
console.log('Starting from initial position');
for (let i = 0; i < moves.length; i++) {
  const mv = moves[i];
  const res = game.move(mv, { sloppy: true });
  console.log((i+1)+'.', mv, '=>', res ? JSON.stringify(res) : 'ILLEGAL');
}
console.log('\nFinal FEN:');
console.log(game.fen());
