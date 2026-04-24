import { randomBytes } from 'crypto';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%&*';
const ALL = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS;

/**
 * Generates a cryptographically random temporary password.
 *
 * Guarantees at least:
 *   - 2 uppercase letters
 *   - 2 lowercase letters
 *   - 2 digits
 *   - 2 symbols
 *   - Total length: 12 characters
 *
 * The password is then shuffled to avoid predictable ordering.
 * It is sent once by email and must be changed on first login.
 */
export function generateTempPassword(): string {
    const pick = (charset: string, count: number): string[] => {
        const bytes = randomBytes(count * 2);
        const chars: string[] = [];
        for (let i = 0; i < count; i++) {
            chars.push(charset[bytes[i * 2]! % charset.length]!);
        }
        return chars;
    };

    const required = [
        ...pick(UPPERCASE, 2),
        ...pick(LOWERCASE, 2),
        ...pick(DIGITS, 2),
        ...pick(SYMBOLS, 2),
    ];

    const remaining = pick(ALL, 4);
    const combined = [...required, ...remaining];

    // Fisher-Yates shuffle
    const shuffleBytes = randomBytes(combined.length);
    for (let i = combined.length - 1; i > 0; i--) {
        const j = shuffleBytes[i]! % (i + 1);
        [combined[i], combined[j]] = [combined[j]!, combined[i]!];
    }

    return combined.join('');
}
