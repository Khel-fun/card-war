// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title CardWarRegistry
/// @notice On-chain registry for Card War game state tracking.
///         No wagers - purely for transparency and provable fairness.
contract CardWarRegistry is Ownable {
    enum GameStatus { None, WaitingForPlayer2, Active, Completed, Cancelled }

    struct Game {
        address player1;
        address player2;
        GameStatus status;
        address winner;
        string gameId; // off-chain UUID
        uint256 createdAt;
        uint256 completedAt;
    }

    mapping(bytes32 => Game) public games;
    mapping(address => bool) public operators;

    event GameCreated(bytes32 indexed gameKey, string gameId, address indexed player1);
    event GameJoined(bytes32 indexed gameKey, address indexed player2);
    event GameCompleted(bytes32 indexed gameKey, address indexed winner);
    event GameCancelled(bytes32 indexed gameKey);
    event OperatorSet(address indexed operator, bool enabled);

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

    /// @notice Player1 creates a game and registers it on-chain
    function createGame(string calldata gameId) external {
        bytes32 gameKey = keccak256(abi.encodePacked(gameId));
        require(games[gameKey].status == GameStatus.None, "Game already exists");

        games[gameKey] = Game({
            player1: msg.sender,
            player2: address(0),
            status: GameStatus.WaitingForPlayer2,
            winner: address(0),
            gameId: gameId,
            createdAt: block.timestamp,
            completedAt: 0
        });

        emit GameCreated(gameKey, gameId, msg.sender);
    }

    /// @notice Player2 joins the game
    function joinGame(string calldata gameId) external {
        bytes32 gameKey = keccak256(abi.encodePacked(gameId));
        Game storage game = games[gameKey];

        require(game.status == GameStatus.WaitingForPlayer2, "Game not open");
        require(msg.sender != game.player1, "Cannot play yourself");

        game.player2 = msg.sender;
        game.status = GameStatus.Active;

        emit GameJoined(gameKey, msg.sender);
    }

    /// @notice Operator records the game result on-chain
    function completeGame(string calldata gameId, address winner) external onlyOperator {
        bytes32 gameKey = keccak256(abi.encodePacked(gameId));
        Game storage game = games[gameKey];

        require(game.status == GameStatus.Active, "Game not active");
        require(winner == game.player1 || winner == game.player2, "Invalid winner");

        game.winner = winner;
        game.status = GameStatus.Completed;
        game.completedAt = block.timestamp;

        emit GameCompleted(gameKey, winner);
    }

    /// @notice Cancel a game that hasn't started yet
    function cancelGame(string calldata gameId) external {
        bytes32 gameKey = keccak256(abi.encodePacked(gameId));
        Game storage game = games[gameKey];

        require(game.status == GameStatus.WaitingForPlayer2, "Cannot cancel");
        require(msg.sender == game.player1 || operators[msg.sender] || msg.sender == owner(), "Not authorized");

        game.status = GameStatus.Cancelled;
        game.completedAt = block.timestamp;

        emit GameCancelled(gameKey);
    }

    function getGame(string calldata gameId) external view returns (Game memory) {
        bytes32 gameKey = keccak256(abi.encodePacked(gameId));
        return games[gameKey];
    }
}
