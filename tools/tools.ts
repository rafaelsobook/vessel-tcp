export function randNumString(): string {
    return Math.random().toString().split(".")[1]
}

export function randNum(_min: number, _max: number): number {
    const maxNum = _min + _max
    const num = _min + Math.random() * maxNum
    return Math.floor(num - 1.1)
}

export function getNumUntil(maxNum: number): number {
    return Math.round(Math.random() * maxNum)
}
