// Limits the API enforces and the forms check before sending, so a request
// that breaks one is a bug or someone poking at the API, not a person typing.
export const limits = {
    groupName: 80,
    personName: 40,
    drawName: 40,
    peoplePerGroup: 50,
    drawsPerGroup: 100,
    // The most people each can buy for in one draw
    giftsEach: 5,
    exclusions: 200,
    // The most previous draws the "don't repeat" rule can look back over
    avoidRecentDraws: 5,
    passwordMin: 8,
    passwordMax: 200,
} as const
