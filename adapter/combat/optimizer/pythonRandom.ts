/** CPython random.Random integer seeding and _randbelow, for upstream search walks. */
export class PythonRandom {
  private state = new Uint32Array(624)
  private index = 624
  constructor(seed: bigint) {
    const words: number[] = []
    seed = seed < 0n ? -seed : seed
    do { words.push(Number(seed & 0xffffffffn)); seed >>= 32n } while (seed)
    this.state[0] = 19650218
    for (let i=1;i<624;i++) this.state[i]=(Math.imul(1812433253,this.state[i-1]^(this.state[i-1]>>>30))+i)>>>0
    let i=1,j=0
    for (let k=Math.max(624,words.length);k>0;k--) {
      this.state[i]=((this.state[i]^Math.imul(this.state[i-1]^(this.state[i-1]>>>30),1664525))+words[j]+j)>>>0
      i++;j++
      if(i>=624){this.state[0]=this.state[623];i=1}
      if(j>=words.length)j=0
    }
    for(let k=623;k>0;k--){
      this.state[i]=((this.state[i]^Math.imul(this.state[i-1]^(this.state[i-1]>>>30),1566083941))-i)>>>0
      if(++i>=624){this.state[0]=this.state[623];i=1}
    }
    this.state[0]=0x80000000
  }
  uint32() {
    if(this.index>=624){
      for(let i=0;i<624;i++){
        const y=(this.state[i]&0x80000000)|(this.state[(i+1)%624]&0x7fffffff)
        this.state[i]=this.state[(i+397)%624]^(y>>>1)^((y&1)?0x9908b0df:0)
      }
      this.index=0
    }
    let y=this.state[this.index++]
    y^=y>>>11;y^=(y<<7)&0x9d2c5680;y^=(y<<15)&0xefc60000;y^=y>>>18
    return y>>>0
  }
  below(n:number) {
    if(!Number.isSafeInteger(n)||n<1||n>0x7fffffff)throw new RangeError("Invalid random choice size")
    const bits=32-Math.clz32(n)
    let value:number
    do {value=this.uint32()>>>(32-bits)}while(value>=n)
    return value
  }
  choice<T>(values:T[]) { return values[this.below(values.length)] }
}
