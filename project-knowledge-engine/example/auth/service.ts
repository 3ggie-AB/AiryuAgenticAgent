/**
 * Auth Service - handles user authentication and JWT management
 */
import { createHash } from "crypto";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: "admin" | "user" | "guest";
  createdAt: Date;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  user: User;
}

/**
 * Authenticate a user with email and password.
 * Returns JWT tokens on success.
 */
export async function loginUser(email: string, password: string): Promise<LoginResult> {
  const user = await UserRepository.findByEmail(email);
  if (!user) throw new Error("User not found");

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) throw new Error("Invalid credentials");

  const token = JWT.generate(user);
  const refreshToken = JWT.generateRefresh(user);

  await TokenMiddleware.storeRefreshToken(refreshToken, user.id);

  return { token, refreshToken, user };
}

/**
 * Refresh an expired access token using a valid refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const userId = await TokenMiddleware.validateRefreshToken(refreshToken);
  if (!userId) throw new Error("Invalid refresh token");

  const user = await UserRepository.findById(userId);
  if (!user) throw new Error("User not found");

  return JWT.generate(user);
}

async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const hashed = createHash("sha256").update(plain).digest("hex");
  return hashed === hash;
}

// Placeholder imports (would be real modules in a real project)
const UserRepository = {
  findByEmail: async (email: string): Promise<User | null> => null,
  findById: async (id: string): Promise<User | null> => null,
};

const JWT = {
  generate: (user: User): string => `token_${user.id}`,
  generateRefresh: (user: User): string => `refresh_${user.id}`,
};

const TokenMiddleware = {
  storeRefreshToken: async (token: string, userId: string): Promise<void> => {},
  validateRefreshToken: async (token: string): Promise<string | null> => null,
};
