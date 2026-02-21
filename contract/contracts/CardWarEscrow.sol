// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CardWarEscrow
/// @notice Escrow contract for 1v1 War card game wagers.
///         The backend (operator) declares the winner after the game ends.
contract CardWarEscrow is Ownable, ReentrancyGuard {
    uint256 public constant HOUSE_FEE_BPS = 300; // 3%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    enum GameStatus { None, WaitingForPlayer2, Active, Settled, Cancelled }

    struct Game {
        address player1;
        address player2;
        uint256 wager;
        GameStatus status;
        address winner;
        string gameId; // off-chain UUID
    }

    mapping(bytes32 => Game) public games;
    mapping(address => bool) public operators;

    uint256 public houseBalance;

    event GameCreated(bytes32 indexed gameKey, string gameId, address indexed player1, uint256 wager);
    event GameJoined(bytes32 indexed gameKey, address indexed player2);
    event GameSettled(bytes32 indexed gameKey, address indexed winner, uint256 payout);
    event GameCancelled(bytes32 indexed gameKey);
    event OperatorSet(address indexed operator, bool enabled);
    event HouseWithdrawn(address indexed to, uint256 amount);

    modifier onlyOperator() {
        require(operators[msg.sender] || msg.sender == owner(), "Not operator");
        _;
    }

    constructor() Ownable(msg.sender) {
        operators[msg.sender] = true;
    }

    function setOperator(address operator, bool enabled) external onlyOwner {
        operators[operator] = enabled;
        emit OperatorSet(operator, enabled);
    }

    /// @notice Player1 creates a game with a wager
    function createGame(string calldata gameId) external payable nonReentrant {
        require(msg.value > 0, "Wager must be > 0");
        bytes32 gameKey = keccak256(abi.encodePacked(gameId));
        require(games[gameKey].status == GameStatus.None, "Game already exists");

        games[gameKey] = Game({
            player1: msg.sender,
            player2: address(0),
            wager: msg.value,
            status: GameStatus.WaitingForPlayer2,
            winner: address(0),
            gameId: gameId
        });

        emit GameCreated(gameKey, gameId, msg.sender, msg.value);
    }

    /// @notice Player2 joins by matching the wager
    function joinGame(string calldata gameId) external payable nonReentrant {
        bytes32 gameKey = keccak256(abi.encodePacked(gameId));
        Game storage game = games[gameKey];

        require(game.status == GameStatus.WaitingForPlayer2, "Game not open");
        require(msg.sender != game.player1, "Cannot play yourself");
        require(msg.value == game.wager, "Must match wager exactly");

        game.player2 = msg.sender;
        game.status = GameStatus.Active;

        emit GameJoined(gameKey, msg.sender);
    }

    /// @notice Operator settles the game and pays the winner
    function settleGame(string calldata gameId, address winner) external onlyOperator nonReentrant {
        bytes32 gameKey = keccak256(abi.encodePacked(gameId));
        Game storage game = games[gameKey];

        require(game.status == GameStatus.Active, "Game not active");
        require(winner == game.player1 || winner == game.player2, "Invalid winner");

        uint256 totalPot = game.wager * 2;
        uint256 houseFee = (totalPot * HOUSE_FEE_BPS) / BPS_DENOMINATOR;
        uint256 payout = totalPot - houseFee;

        game.winner = winner;
        game.status = GameStatus.Settled;
        houseBalance += houseFee;

        (bool sent, ) = winner.call{value: payout}("");
        require(sent, "Transfer failed");

        emit GameSettled(gameKey, winner, payout);
    }

    /// @notice Cancel a game that hasn't started yet (player1 can cancel, or operator)
    function cancelGame(string calldata gameId) external nonReentrant {
        bytes32 gameKey = keccak256(abi.encodePacked(gameId));
        Game storage game = games[gameKey];

        require(game.status == GameStatus.WaitingForPlayer2, "Cannot cancel");
        require(msg.sender == game.player1 || operators[msg.sender] || msg.sender == owner(), "Not authorized");

        game.status = GameStatus.Cancelled;
        uint256 refund = game.wager;
        game.wager = 0;

        (bool sent, ) = game.player1.call{value: refund}("");
        require(sent, "Refund failed");

        emit GameCancelled(gameKey);
    }

    /// @notice Owner withdraws accumulated house fees
    function withdrawHouse(address to) external onlyOwner nonReentrant {
        uint256 amount = houseBalance;
        houseBalance = 0;
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "Withdraw failed");
        emit HouseWithdrawn(to, amount);
    }

    function getGame(string calldata gameId) external view returns (Game memory) {
        bytes32 gameKey = keccak256(abi.encodePacked(gameId));
        return games[gameKey];
    }
}
