// Piece type definitions
export const PIECES = {
  KING: 0,
  QUEEN: 1,
  ROOK: 2,
  BISHOP: 3,
  KNIGHT: 4,
  PAWN: 5,
  NONE: 6
};

// Piece names array - indexed by piece type
export const PIECE_NAMES = [
  'King',    // 0
  'Queen',   // 1
  'Rook',    // 2
  'Bishop',  // 3
  'Knight',  // 4
  'Pawn',    // 5
  'None'     // 6
];

// Piece values for evaluation
export const PIECE_VALUES = {
  [PIECES.PAWN]: 100,
  [PIECES.KNIGHT]: 320,
  [PIECES.BISHOP]: 330,
  [PIECES.ROOK]: 500,
  [PIECES.QUEEN]: 900,
  [PIECES.KING]: 0
};

// Icon mappings for UI - using piece type numbers as keys
export const pieceIcons = {
  [PIECES.KING]: "fa-chess-king",
  [PIECES.QUEEN]: "fa-chess-queen",
  [PIECES.ROOK]: "fa-chess-rook",
  [PIECES.BISHOP]: "fa-chess-bishop",
  [PIECES.KNIGHT]: "fa-chess-knight",
  [PIECES.PAWN]: "fa-chess-pawn",
};

// Square names array - arranged so index matches bitboard position
// LSB of first byte = a1 (index 0), LSB of second byte = a2 (index 8), etc.
export const SQUARE_NAMES = [
  // File a-h for rank 1
  ["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1"],
  // File a-h for rank 2
  ["a2", "b2", "c2", "d2", "e2", "f2", "g2", "h2"],
  // File a-h for rank 3
  ["a3", "b3", "c3", "d3", "e3", "f3", "g3", "h3"],
  // File a-h for rank 4
  ["a4", "b4", "c4", "d4", "e4", "f4", "g4", "h4"],
  // File a-h for rank 5
  ["a5", "b5", "c5", "d5", "e5", "f5", "g5", "h5"],
  // File a-h for rank 6
  ["a6", "b6", "c6", "d6", "e6", "f6", "g6", "h6"],
  // File a-h for rank 7
  ["a7", "b7", "c7", "d7", "e7", "f7", "g7", "h7"],
  // File a-h for rank 8
  ["a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8"]
];

// Initial castling rights
export const initialCastlingRights = {
  white: { kingSide: true, queenSide: true },
  black: { kingSide: true, queenSide: true },
};

// Color indices for internal bitboard use only
export const WHITE_IDX = 0;
export const BLACK_IDX = 1;

// Castling masks
export const CASTLING = {
  WHITE_KINGSIDE: 1,
  WHITE_QUEENSIDE: 2,
  BLACK_KINGSIDE: 4,
  BLACK_QUEENSIDE: 8,
  ALL: 15
};

export const ZOBRIST_SEEDS = { // 803 entries
  pieces: [ // 768 entries
    [
      // side 0, piece type 0 (64 entries)
      [
        0xed82756a732172c4n, 0x954fe991fb355c20n, 0x3e55b9c2c3901c10n, 0xc9a01864c36be754n, 
        0xd2dc05a27f47bbb6n, 0x0acbcd1a69f44125n, 0xea846d3c1b8e00d7n, 0x67bed473823242c6n, 
        0x5c61222de2f2c6e0n, 0x1d906da4bf593ad1n, 0xacf8ed6520ca605an, 0x1c15213d00943cecn, 
        0x5e9f74fbbfbced01n, 0x6659e2305b1a7913n, 0x731870f41c9a7d46n, 0x3046e483966451a6n, 
        0x0017234cd63756b5n, 0x5100354a9eb43cedn, 0xfdbd885aad828927n, 0xae745ed118c8d9a3n, 
        0xea34b63c09b458d8n, 0xd8156646e081b21fn, 0x286f42e4b9117cbcn, 0x218b1269d012288dn, 
        0x6134fe5e8a57d1c6n, 0x3dd93fbfa14e536an, 0x79bc0179be4f934en, 0x15fdfb1e83b28119n, 
        0x0684575434494f01n, 0xc2a817f610c25ecan, 0x2ec91834bd41231cn, 0xa88c84b451209923n, 
        0x7913bf0e0d37e1b2n, 0xe60aa7baa9dee031n, 0xf08bc9c1bf4031f5n, 0x066e84d8aa5f4919n, 
        0x02d83b20f7b3f45en, 0x3a2526d8cc9aa98fn, 0x2e11423b51f81f9bn, 0x161e766bccfdc54an, 
        0xa5077f6ec7b48e77n, 0x83b78d50b3768221n, 0xa20d3880f0cdee7bn, 0x062d14f0ce55869an, 
        0x16e764698ab06a1en, 0x7e9fadc5757709f3n, 0xd58541b4f9266025n, 0xab96c8eec82744f2n, 
        0x537bb9937a06c53an, 0x4633a2e2bdd7e1d5n, 0x14cd764e928f5e43n, 0xaea6825a6144ce95n, 
        0x88ef06d2e7fe860cn, 0x402473f64cbfc5bdn, 0x8eaa2a63a272f3c3n, 0xc9545b0cff70635fn, 
        0x8c9e0b318caa8f61n, 0x16314a74acc1d2aan, 0x84bc419f33b91988n, 0xf7cfb1aec49c94ddn, 
        0x51d4dee49ee39ba0n, 0xf5d7e2ee037c4fb3n, 0xdfa0c264b15e348cn, 0x03a3ff6b07fd19f2n
      ],
      // side 0, piece type 1 (64 entries)
      [
          0x315adac10e02b26bn, 0xe7233ed9360469d3n, 0x4d12e54a4a0c024dn, 0x320a666711391046n, 
          0xab309d55de0f17f0n, 0xfe166aaab33e26abn, 0xa881bc468f4abb2cn, 0x025ec7ed7fe6ccf6n, 
          0x00a2e6d850c6ac37n, 0x33bf6ae1c9a36a95n, 0xafac4c8adb778a37n, 0x5375688cd68ae215n, 
          0xf70e471ed63a2dc5n, 0xfc64b714a61129c3n, 0x8ee0e2359da9bdbfn, 0xfab9f22fd7ecf322n, 
          0xf8480a5185aa3086n, 0xb7f14580d79f7b20n, 0x17199046b0af3500n, 0x0d8c71ffb354ba7fn, 
          0xf687051565d212f5n, 0x42f9e88dacedb950n, 0x65cd7aaab591afc4n, 0xf0a6c60a6f161cbn, 
          0xedd091efd077e22bn, 0xd5ca4a41b0fe9061n, 0xc8d54e774dba9bfan, 0xbeda52382763ba47n, 
          0x206b8c25acbfebcbn, 0x51562e99205475e3n, 0x7158c0d76f10da8fn, 0x368608f800ec405en, 
          0x80aaf08a02664a45n, 0xc992606c6b7e0ca2n, 0x3d2b38e9683a6364n, 0x01d79a2375aad9een, 
          0x1363ee1a52b1d00bn, 0x2f91d3e7f32243bfn, 0xc9b0f248adef2cdbn, 0xfab3007a3bae5fean, 
          0x3a2fc61057d96cc8n, 0xe952f13cbdc6a654n, 0x2a022323ed3d6334n, 0x53c6dc3a7edb378bn, 
          0x74903be9c9e22a4an, 0x0539449817a2a936n, 0x03f65b03bb93ddf2n, 0x9dee4baf3adb42f3n, 
          0x814f6c4a09a51fa2n, 0x07d598741981c9ffn, 0x98e8ada5b7603f70n, 0x117adf8a2c8800a3n, 
          0x1e7a4ebb37e36daen, 0x72e60a82dc8fc10bn, 0x16745e642aac9ac4n, 0xa712e71480480034n, 
          0xaf397b52f92cec78n, 0x5ba7ae09fe6f6764n, 0x9898df944d18d63en, 0x498bc555f5fedc45n, 
          0x77ae7fddbfba26f2n, 0xd4132911bb8e0c01n, 0x696419bec9d6d958n, 0x94bfd7f577a30f23n
      ],
      // side 0, piece type 2 (64 entries)
      [
        0x798bb15d89be2a43n, 0xcaba22940a3d3c43n, 0xbf9118ba373fd208n, 0x6acec28126014d0cn, 
        0x7b60d3ebff80e82dn, 0x3c6d858faa333ba3n, 0x8f0be7507c92a16cn, 0xe706757f8f49b8dfn, 
        0x11e1afc5f7d276a8n, 0x36f1df3f00fe149an, 0x63e41c74338156d3n, 0x1f94649350a0f596n, 
        0xcf6f55944a03af56n, 0xe87d3a341bc09173n, 0x9b4e478aadb2fc52n, 0x97dbabb93ea09ddbn, 
        0xe464f7e2f740217an, 0x8083f2396d5d4229n, 0x7d5464d1cd3ea206n, 0xe93e6cf4a5f7301bn, 
        0x10b1c2c4af2795b0n, 0x2bd1030d68335cb1n, 0xe58e29959250b921n, 0xb593e5658df303b1n, 
        0x9f56ef1d8d568a86n, 0x911d35d6ecc18c58n, 0x54525306929823edn, 0x0e5c5ca3fa5c8469n, 
        0x9ec5e3823f5cbab8n, 0x5983b741bbea63bbn, 0xeedc4b825840a544n, 0x45a99a14cd8aa66cn, 
        0x6b0c8406b2f10917n, 0x45a29c13af1ffee9n, 0x235d9eddbc8d1563n, 0xfaa564673473ec75n, 
        0x990816c75f8a7b90n, 0xdc202888f5aa49b1n, 0x536e1cc7064e343bn, 0x948491bc4a2f657cn, 
        0x31dfbf4bae4659dbn, 0x6a8e5cf9d16d72f5n, 0xdf323eb9f7cc736en, 0xc87f360dc74a6681n, 
        0xd7c355cc95d25b47n, 0x33c15d46c2da1f29n, 0x3dfffa8c146bf1e2n, 0x69063aaf009fe8f3n, 
        0xbee8c0491f43b078n, 0xe8603780958990bdn, 0x8a4b2c9b311b63ean, 0x6973e017da1e21b3n, 
        0xf7a1425cc529f82en, 0x093fd807a98ef6efn, 0xb77f0ae4949a1c76n, 0xb0b186c8f8d771c0n, 
        0x00925f6960d20b77n, 0x88c8b2f45aaa46ddn, 0xa0700fc56a3e957bn, 0x1780fc064cfec918n, 
        0xa8025e42feaa139en, 0x7044aac282d97467n, 0x20abf459bb57974dn, 0xd1f8e8353e32b416n
      ],
      // side 0, piece type 3 (64 entries)
      [
        0x63795d8ea0d418ddn, 0x5d419b60ea1577efn, 0x05789b1a5e6960d5n, 0x068dbab55793f978n, 
        0x9fa681166556f110n, 0xfca7493bde663d85n, 0xfbdb27d63bfc47f4n, 0x7a6cdd5a2d200bc4n, 
        0xb7397d298a686cf9n, 0xcf32a572967b587fn, 0x87f95c3ed0cb7051n, 0x6829669bd9a7e478n, 
        0x3d1e626f178bafc4n, 0xbc1cefc8858ba379n, 0xae63c4c7bc3ea8c5n, 0x03016bdcef55f5ebn, 
        0x06f3756675b7b783n, 0x9e2d436237413762n, 0xa8331fe2bbb1e5fan, 0xea4294293d950f4bn, 
        0x5f9ef77d2d4842e6n, 0xf1ab0bffd32e5ed9n, 0xfa774ba46e9335bdn, 0x5ff8e5cf518cbf69n, 
        0x5f5fb6ca94718b90n, 0xa2b10bfb56cbd660n, 0x5ca676faba649060n, 0xff0db77252e80735n, 
        0x1a99941cfda29f43n, 0xfdd9b62e37d379een, 0xc7a792bc1f13571dn, 0x32b922293fa2f09bn, 
        0x6c2fd51286198899n, 0x3c94c834a1b4655cn, 0x9e870852dd1b4be2n, 0x50252f69cb11d23en, 
        0xb3cdf5e8c3c703d6n, 0xfe4fd8a783e136abn, 0xc3bb4c87180540b0n, 0xeee3fe1b9253c52cn, 
        0x133b2f2800cc223an, 0x8c059dee7382ee55n, 0xe15101e1dd02d4f5n, 0x44370afdbe699d5cn, 
        0x3ac2236a9121fd43n, 0xef7f2d380fd81639n, 0x7b4d52e324b56e67n, 0xf82c3e2365e74fd7n, 
        0x8ea8f570ecc7e7c2n, 0x2bea11a1b4de96fan, 0xa577cd3fb2a462c4n, 0x6827e483d5579790n, 
        0x876feb0aea0bf334n, 0xc7c0650fe544d9d9n, 0xef69269631fcba00n, 0xd85dc306ee3c4d28n, 
        0x6106e9bf91baf210n, 0x6a8beee52fc7bc4an, 0x423f4f6e958a9a78n, 0x2fbc7e743e7df848n, 
        0x198c1462239eb634n, 0x388627ef4976f385n, 0x5011c1fafec39028n, 0xafb6766f10c72fa9n

      ],
      // side 0, piece type 4 (64 entries)
      [
        0x90df04acb8b354d4n, 0xf8f52b0f8f1e8187n, 0x696a0807884b8b5en, 0x858e8f70d0ba6027n, 
        0x5918a2c4c4a1cd06n, 0xc5383c4b828257abn, 0xf2960f43ba9eb7f5n, 0x7a1e14cbe714c56dn, 
        0x7b754d208c4f1af3n, 0x957b1843358363c8n, 0x18dfc09fa826a6b5n, 0xd8bce62c742ff6dcn, 
        0xb403aa433b921b72n, 0xdc8e472c654d1f39n, 0x680aa89645cd5c8an, 0x79de6eca0ab5309bn, 
        0xba5cfe3a5f7c8a7fn, 0x0a23bc294c5343een, 0xc8be40e4c88d796an, 0xd074b29695a3a35dn, 
        0x7e4b7774177ce136n, 0x05b05bae8574fec4n, 0xa89bd4a85358a386n, 0xcfdc052c295b6bd7n, 
        0xa16bc830fb0e4cbcn, 0xe8ff00c2c390baban, 0xa04084622e3ff355n, 0x5ac8e84a3c365e25n, 
        0xfb8e3bcc64cd9536n, 0xcf4f837d18baf01bn, 0x2f2592cd5ef9d337n, 0x06978276ac8a010bn, 
        0x6af6911df4060500n, 0xafb38aa8f41f9495n, 0x009325657a89bef8n, 0xa39f85e003721454n, 
        0x438c28c32193e097n, 0x5f671af647b957a6n, 0x89563e7af47030c5n, 0xfa5bfd3bb8785d3fn, 
        0xd7540f98c90386een, 0x866cf9453110fd24n, 0x0074204cac14a73fn, 0x539fcaa715f5ee9cn, 
        0xfe2d5a80a7a69f73n, 0x2c577c6f7a2a2238n, 0x7d3a5476a900c11bn, 0xe68d4cc2a2088ff4n, 
        0xac0ad7e4762701f8n, 0x398f22307e1b1569n, 0x665fe18cb11fc968n, 0xb525651146044ccen, 
        0x57ac461eb3499e57n, 0x12775379987aa4acn, 0x1a0713e5b3ca6f02n, 0xb2abfb9aca42e9a9n, 
        0xf58eeddf2b3bd0a3n, 0xc68a947b1d38be41n, 0xce2c522ddded5400n, 0x98ae86dd8d8ac06cn, 
        0x087f6d2e0161e4fbn, 0xa1cfbe4aad31a198n, 0x712d402e317b99den, 0x1648de5351c428c0n
      ],
      // side 0, piece type 5 (64 entries)
      [
        0x6fad11cb321c9621n, 0x5732479aa6f1b268n, 0xe8b3a13ed945f3efn, 0x49714b484de60395n, 
        0x647b4eb71db33c02n, 0x447f301ff5f7a9cfn, 0x726824aed0ce7a93n, 0x4b57e549a9734ff3n, 
        0x1d6e45da3bb1c468n, 0xe935fb9d629490d0n, 0x2733e508583f8e42n, 0x39c9df63478bf9f1n, 
        0x4ff4d48afb426ca7n, 0x1efe98a59fd9429dn, 0x18464f698de7207dn, 0xf51465695b9cf13an, 
        0x95f7e580424cf840n, 0x8e9eeef4261fa430n, 0x3e3e3df30bda871fn, 0xc4097f729e91a204n, 
        0x73782f76c2efd62dn, 0x16a97bc108eadc59n, 0xef06a0340ae3970dn, 0xf60343280a1569een, 
        0xf3059350d87d2c60n, 0x9d459181e4e5c9d2n, 0x718cd7c177d93956n, 0x5ca76b467fbb081en, 
        0x238fef5b5f84737dn, 0xc5b93b5114ec9bb4n, 0x229c95aa959a0d83n, 0x536cb47705c3ed37n, 
        0x191f020837e822e8n, 0x70ef9a77f5e19c89n, 0x86a71c061d907a74n, 0x75e574d3d2ebc95cn, 
        0x426dffcb3187b4c1n, 0xf6706705752d49ffn, 0x631a398907839cc9n, 0xb780cdc592cd082bn, 
        0x0c069ccd328f844en, 0xbb4b676c2da03eefn, 0x321528279ea11823n, 0x38e3b7cd50790215n, 
        0x03c6f4b1c0ab88c0n, 0x034c3f63f9ad00e5n, 0xd466c825a8b1c384n, 0xf07342de37d51b00n, 
        0x2250d1085cca73aen, 0x083f70ee64c6bd0en, 0x25e13ee4397ab667n, 0x2fee41f4d4629236n, 
        0x5a865015f220597bn, 0x7dee0dd1cd630ac2n, 0x87196fcb7579f05an, 0xe8c3e540080caf5bn, 
        0x439e1aa25f53c32cn, 0x9f1fffb248a29143n, 0x0b9db2211615bf93n, 0xc424aeca9c84c507n, 
        0xdd7212151dfa13a3n, 0x6dc30f191d374e16n, 0x00cee396a455670an, 0x0da3d74423cce6cbn
      ]
    ],
    [
      // side 1, piece type 0 (64 entries)
      [
        0x9336795d97352932n, 0xc611c45b39b24c21n, 0x3985b36a0d12bbf7n, 0x69e2b6852e92fb20n, 
        0x41486a924a3b64e2n, 0xf5c0e693e3fdb9ben, 0x1efd91395b8e2ff8n, 0x8383fce9cb5a6046n, 
        0x837566fe2bb213a0n, 0x76d209f1be10ffe8n, 0x2dac53aee6a830een, 0x066881656ab674aan, 
        0xf33054dee896f352n, 0xbe31f00f98887546n, 0x01d892cbb93a9989n, 0xd5ae2a4ac65ccbc4n, 
        0xa5df0f40f146d484n, 0xb8fc49a9e99f3bcfn, 0xde9ddffadcd8a8een, 0xd79bd1e2a2f5b6bcn, 
        0x5eee013bcf51f3a5n, 0x8c37e52aa8555441n, 0x4b4bdbc8015a99ddn, 0x8f67831b64bf7666n, 
        0xdeff39540b309ec1n, 0x22a2ec4e63609e6bn, 0x5e15d615f563572cn, 0xf61a7849ed843fb7n, 
        0x0f7a8e0783acbb7an, 0x94c41955116b1bcan, 0x82400cde72db6e76n, 0xf93c11b2303ac074n, 
        0x06b2fbf0d5639e2fn, 0x4ea5480b8cd9dbcdn, 0x4c2156cc19122eecn, 0xb4d3a7ba29089e24n, 
        0xe7f758c0b1837634n, 0x39c0dddfb84b284dn, 0x5f5dd40c02b4ae6an, 0xbdfe619e049232fen, 
        0xde8ef52b5d6e2073n, 0x406ab4dfc30f4db6n, 0x090365a73db61599n, 0xf823c790fbfe10afn, 
        0x647079f7a9de9a2cn, 0x944537ed5232640dn, 0x75cb3b8e1b2be67cn, 0x3f821c958de1b94fn, 
        0x5100daa95d97197dn, 0x0f9c874462074d1an, 0xbc789b6e4c01e4c2n, 0x44d4a8377aaba06bn, 
        0x46cfff313d970d77n, 0x2fdd526b3c1c5a8fn, 0xe82fc5b1254a679cn, 0x997c6ad0b49fcdc4n, 
        0xd62551fa1e66ae78n, 0x143f05de2783a2d3n, 0x8a6d4c04b089a5ccn, 0x341edd88f95487e4n, 
        0xdbf4a7cfb14f00bfn, 0x274ac34fde793f96n, 0xa2e73527c8e3a71bn, 0x328a147a7bc6a273n
      ],
      // side 1, piece type 1 (64 entries)
      [
        0x8e36d7e23e86d051n, 0xe5d227f6ca016e79n, 0x86dc33350186fe1en, 0xdcd0c0655b468f12n, 
        0xbe206f1a44207831n, 0x8fb573974964a9b5n, 0xbc56a474799b21cen, 0x2b819da4902e9028n, 
        0x4159861db9b87fddn, 0x648e6f28a11a9d93n, 0x585787b9957485c1n, 0x0e02b6ebcfb233c8n, 
        0xbd3ec30cb2b25e07n, 0x6ba8c34210f0be32n, 0xcfbed0f56f544610n, 0xd20957b6e8f161c5n, 
        0x7cf7c41e8098875bn, 0x8625be9cb9103e93n, 0x7bf7f037ee2b2847n, 0xb118ac7defc0370dn, 
        0x77329cc35699e88cn, 0xabf8e78396f9a73dn, 0xf4befdc8641464d7n, 0x51fbe97f41ae6994n, 
        0x1bea70171ac701a8n, 0x6dd088de108b40c4n, 0xc002a47244936120n, 0x4f979b9a4e7e5b54n, 
        0x70e019c66f82769dn, 0x2a841d08d9347f5cn, 0x6b15cdbaf441abebn, 0x01d2cdfb9caaf26fn, 
        0x5085a75d80077749n, 0x94d432e450d1fa22n, 0x89750d01dfa00724n, 0x01015e5fe32e842dn, 
        0x23023d92e52663bbn, 0xfdcc26556dbf75adn, 0x0550662b366bfd85n, 0x58bab3bed59430fdn, 
        0xfae48defd6652418n, 0x2c39ca3dd9009e21n, 0x07dadcd806c3e4ben, 0xab8d576738a071d8n, 
        0x1cb4788e73a4d81en, 0xfc31c3d48ac01580n, 0x546c0b3a77a2e700n, 0x89c7aaa14977739bn, 
        0xe8b286ad12a907c2n, 0xd044e77939ca4458n, 0x35231e3a55e58b80n, 0x0bd62597a1975b47n, 
        0x62db0302c38cdc75n, 0x0f8b6a7e467ac5dan, 0x6b09379fb94c8bb2n, 0x9eb6da32de3dd06dn, 
        0x117aec6b7e4cbb7dn, 0x2767ea04d7337a25n, 0x0efbf5171c21925cn, 0xe8d07e8f22bc87f8n, 
        0x5dbc123c257f121cn, 0x1748c7f58cf67de4n, 0x98eb691fca29c488n, 0x5fb7fa0929c1157en
      ],
      // side 1, piece type 2 (64 entries)
      [
        0x3192b78c96434350n, 0x8434127cf0abcb7fn, 0xeb8ce97bfea57e42n, 0x832293f34e6b4c9bn, 
        0x20ff1fe4ee654651n, 0xb784ca23a50bb1bcn, 0xb76b768b901a7018n, 0x22f16c579a6fa6a6n, 
        0x2420a5a368820566n, 0x10fa2b237b824c6cn, 0x8daa9aa1d041a333n, 0xaa7558f836ebe6dbn, 
        0xe4a4abba984efa43n, 0x33b6c41709a02925n, 0x1916b0a140148608n, 0x75f14918c6f68e53n, 
        0xe85a80906ed6d0e1n, 0x4eee136c58c8588fn, 0x30555d2d339f2066n, 0x51bbc627f15a45adn, 
        0x3e02586c857fe8fcn, 0xf6f88cca7dffb2d3n, 0x6e80de96980f8cf9n, 0xabbaffad9c63bacdn, 
        0x63a05673cc09c7e0n, 0xad7162f55b055c49n, 0xb1514d435b14b645n, 0x44b3163e12e321bbn, 
        0xf3b5c427836093d7n, 0x6ecb033a88697d3cn, 0xb0acf4a6fbe152d0n, 0x1e542c6c2f23deean, 
        0x18f1eeeb01672bf7n, 0x968eeb61e00ade0en, 0xfd420f05e0d04a2fn, 0x7f8d1adbda108959n, 
        0x08f1499993759a60n, 0xa93a1b48587740efn, 0x91f00d73f7798038n, 0x47927a0ef19fef53n, 
        0x83e927437af882d1n, 0x8708a3ac5c074491n, 0x6b9b3d6ebea8985bn, 0xc0eda674868e4181n, 
        0x19b041a8b986f952n, 0x4ccf91895abdd848n, 0x177e3fc8ed134d13n, 0xb97adf11bf3fc2a4n, 
        0x83e1713f26273e60n, 0x6275fae73adf7333n, 0x257c7977242e4ee2n, 0x288f603777c7e245n, 
        0x64aa5de3e7ad4b2dn, 0xe2769d175af70a38n, 0x62a666237fa5ae37n, 0x6a5a3010b05a2ea9n, 
        0xc45553cf55aff70fn, 0x6f716a09ed974b78n, 0xa17c817c2919da3cn, 0xe18762580859a325n, 
        0x4257b55565a12202n, 0xabb1488a80aaa31bn, 0xcb43c191a05ffaebn, 0x47d491c2e21d9ac8n
      ],
      // side 1, piece type 3 (64 entries)
      [
        0x9cf9ebd6cdb065ban, 0x03019354173a3da6n, 0x020f68f5a95107c4n, 0xbe350a15d8a4d4ecn, 
        0xed245ccb0c2b359cn, 0xe7ab62a6a2b816dan, 0x689917e9bc6ed524n, 0x6fd24ac788dc2688n, 
        0xedc145bd039a153bn, 0x30798eb41b3f3975n, 0x2edf5b29757570c2n, 0xbab75a5652787980n, 
        0x0750a4cc511e6badn, 0xc24da5022c8ab69cn, 0x14829ad2deb64de9n, 0x8fcfeb682e7df56fn, 
        0xaa8bf3ee6de5978bn, 0x762fc7079916f6dbn, 0xfa29e70640aa30een, 0x76b2ef0e4295d332n, 
        0xa5492c2c20d68576n, 0xe06f5329ed45ee4cn, 0x30ebd78412eaebdcn, 0xae0d43310f79e687n, 
        0x241dd10a6ead06d2n, 0x7e61486ddf9c20acn, 0xedf70b61f569ad27n, 0xc3327324a9f21273n, 
        0xaa358cd7b6aa8b8en, 0x6485aa395d5e6bb4n, 0x56e52794fa9f7e97n, 0x660aa83de848785bn, 
        0x435b0b2d79487415n, 0xa0ecc419620556bdn, 0x6d9db4506292c104n, 0x5b8eedeb8375c1b9n, 
        0x2289a635e2dffef1n, 0xfbf7c20aaa156e58n, 0xf8a38dfc1ce2d1dbn, 0x279407b7d65732b0n, 
        0x31e8d5073e914f06n, 0x940e693e338c6d7fn, 0xa3081f984f1ed80bn, 0x268fa4ef9b534a26n, 
        0xe65af6a522364da2n, 0xb581a9ff7fb95360n, 0xaf51c9adeb684809n, 0x3ffd1042aa79ed5dn, 
        0xf6046329b012ea55n, 0xf83ac4e433ecd069n, 0xa31049949a01e76fn, 0xa494fd83f4c76215n, 
        0x442630bf53153a06n, 0xd8bd55388d4eb3a1n, 0xb72f80edf673395dn, 0x76288389750f2d58n, 
        0x18e71ac97d2c56b5n, 0x4684bdc41ea90128n, 0x20cc6e6ed6d6c551n, 0x82a387c78ffe16fbn, 
        0x342901a94b40ab51n, 0xce5f7e0e0e45f853n, 0x34c51cf357582755n, 0x70c76135c9e58c42n
      ],
      // side 1, piece type 4 (64 entries)
      [
        0x317be4fc09fceb7bn, 0x799dbb942e7a168dn, 0x8cfc991e2f8ba1a0n, 0xb4104bc1c53ff581n, 
        0x870cb5d4c530c752n, 0xa9d0750d8d9ba28dn, 0x12d62b157006698an, 0x56833332318766a2n, 
        0xf47500ebc8c7189cn, 0x1f92e9a1106c04a6n, 0x6d86aa55a0225022n, 0xa4b79143a14d0056n, 
        0xe5bb657f52c7f272n, 0xcfb7b62455ec03a0n, 0x5b3d9f83afbfb460n, 0xe2c9aaab4b05bfd5n, 
        0xb4f9771297d105b3n, 0x0cc92216b227ca5dn, 0x1b7b973ef181ffb4n, 0x893763e0d51830e3n, 
        0x7825675ef64580b1n, 0x2a64ff6145a90e09n, 0xbb3aebd9708571b3n, 0x5b66dd68a0db2b4en, 
        0x62ed18dd2d30135bn, 0x1a21902a3ae04e03n, 0x82b7d60ed6fd0f97n, 0xca0e7f3cc38dfd1an, 
        0x887bb22bdaf891abn, 0x97e3b9f8adc012b0n, 0xfd6bd9ab62f28ff1n, 0xda45199dfc7611d7n, 
        0xf25690f65a5076f7n, 0x1ddd0f0912a1c2ffn, 0xfe86e3cfdfefaf5fn, 0xfb1e5b1ddd49f5f7n, 
        0x63313a47992cd885n, 0xb3ce1a4f832f3384n, 0x7aef1512a0963e82n, 0x6908b7a29326afbdn, 
        0x687b58f1c8bf029dn, 0xcc823af8d3bb1e60n, 0xaf0febc4634d6a69n, 0x582f708b7859546bn, 
        0x3d70a756cd344d65n, 0xe23f1e4dbafeeaeen, 0xb32579cc8fe2d0c4n, 0x699c535cffadc020n, 
        0x1906a4db6b1fbbfan, 0xdc0768f1cf2dd696n, 0x0fe75e357875d3ffn, 0x712f5face11db3f9n, 
        0x49a353ab8b7bb5a3n, 0xf33804d144b89ee6n, 0x0f57a9fff95beea2n, 0xcf8f3975810331a7n, 
        0x9054937dae75c0cfn, 0x48bcdf7fc2967b79n, 0x4464ef7699b97f0bn, 0x0f4c50ced96ef5acn, 
        0xc79383f7e1c54f02n, 0xc0628a032882e5e9n, 0xd5dc7663eaa74ebfn, 0x844239959e66f673n
      ],
      // side 1, piece type 5 (64 entries)
      [
        0x2d9979ea23bcc2cfn, 0xcb18d58117c27922n, 0xe4884777b6dc2b71n, 0xb2498bf753d84548n, 
        0x3b5f6b1a0d032823n, 0x99585d52f4552dabn, 0x7ec8926bb18c860fn, 0x7c181b1550995c05n, 
        0x2d4f10bb472cc6d5n, 0x2fd142372faeb3f7n, 0x34f330bfdfc6fb12n, 0xdff651d43370f0efn, 
        0x1f3c8656c7cad742n, 0x9eb0c35fa520dc1bn, 0x662dc79312f4db65n, 0xea670aa364990c6an, 
        0x2d6ac484116db147n, 0xaaf3d7a8d316ec25n, 0x9c2a2286632aeec1n, 0xe3bcba19947f6579n, 
        0x6a6d5ad0e421b107n, 0x7e8c9d77dff3da6bn, 0x5aeadbd1d78e9797n, 0xf457c14e8d365a5fn, 
        0x923ef0bfd804e414n, 0xad07c86e00a8b8b6n, 0x65f1cb0669a8ec2an, 0x52ae7afdcfe6f66bn, 
        0x9633cbf2d404cd98n, 0xd7d5695d4c6d35c5n, 0x06fd4eb19c52ba14n, 0x26c657e3d160388cn, 
        0x68e15319656919d4n, 0xaa507cf086d64064n, 0x64cfd5b2f9b4771an, 0x1c13130a545977b2n, 
        0x20a5947bf8cb0a7an, 0x91657738c532d59an, 0x587344b8498230f2n, 0xb2bad907df884cd6n, 
        0xfbb723eda44278b5n, 0x949a364bc7a578fcn, 0xa88128882653e721n, 0xb9dcbb73c74125a0n, 
        0x5a7e5c435b122662n, 0x353f04b67ec9d60an, 0xc6661ab1b218ecc1n, 0xcc335c4cd60d4e14n, 
        0xfbfe92f2614dc3f8n, 0x585cdba6280b2ee1n, 0xc3f1c1058f3d4bd5n, 0x94c6167a6c5f92e8n, 
        0xb941c9064bf3df32n, 0xc8817ccb3481d8abn, 0x2805ed0526e9fee5n, 0x4954afb3d6a66bc4n, 
        0xc3ed134f3b3a7406n, 0x24ef5194a7097759n, 0x92e8a981e1bebc31n, 0xe6641167ae40556dn, 
        0x64cf24f05e41b331n, 0x8de3b67fac52957an, 0xa617ed116e95b78en, 0xcf85f0439cffea11n
      ]
    ]
  ],

  // 16 entries
  castling: [
    0xe19a0ed4f4476f3an, 0xa252a9cdb92d9d99n, 0x684b23d8894c5a7bn, 0x2bedf89bf65e9d64n,
    0x6c0aad20b88c1363n, 0x6a161ee19f9f9ac8n, 0xe74d6ee5c35d80a1n, 0x350f8913255f0aacn,
    0xd534a2fe19d051een, 0x6aeb24fa5370e867n, 0x7c29b9a4477ffc05n, 0xa3492d6a210ace23n,
    0x28c2eeb3a189765fn, 0xc2e9bc1067092b4dn, 0xb624f2cf794607fbn, 0xe0ed65a3a68c6ec5n
  ],

  // 2 entries
  sides: [0x575bae22c55bf622n, 0x546dd47aeec56881n],

  // 17 entries
  en_passant: [
    0x5f79d7c1a69e20afn, 0xea17b487b0622cd7n, 0xf097838978c9ca18n, 0x178ab368cb094b56n,
    0x83ea01b57764b1cdn, 0xfde0212b2f3f8468n, 0x2a1ee57ade12e31cn, 0x523d09a47eebaeefn,
    0xbf128771a60dcc75n, 0xfe8e5325825fd46en, 0x7999663a1c5ba6b3n, 0xa0390c4f15c4a633n,
    0xcc83c7d9a0cf1e25n, 0x52264c7152dac05bn, 0x6f80c4c36bc521f3n, 0xd33bb50387daeaf6n,
    0xbcaddf44aa46971dn
  ]
};
