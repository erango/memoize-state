import {
  proxyState,
  deproxify,
  isProxyfied,
  getProxyKey
} from 'proxyequal';
import {updateCacheLine} from "./cache";

const nothing = 'PROXY_EQUAL_NOTHING';
const emptyArray = [];

function addAffected(callGeneration, affected, object) {
  const key = getProxyKey(object);
  if(key.fingerPrint.callGeneration===callGeneration) {
    affected[key.fingerPrint.index].resultAffected.push(key.suffix);
    return true;
  }
  return false;
}

function deproxifyResult(callGeneration, result, affected, returnPureValue, deepDive = false) {

  const isInProxy = isProxyfied(result);
  if (isInProxy) {
    if(addAffected(callGeneration, affected, result)) {
      const preResult = deproxify(result);
      //return preResult;
      return deepDive ? preResult : deproxifyResult(callGeneration, preResult, affected, true, true);
    }
  }

  if (typeof result === 'object') {
    const sub = Array.isArray(result) ? [] : {};
    let altered = false;

    if (result && Object.getOwnPropertyDescriptor(result, '__proxyequal_scanEnd')) {
      Object.defineProperty(result, '__proxyequal_scanEnd', {
        value: 'here was spread guard',
        configurable: true,
        enumerable: false,
      });
    }

    for (let i in result) {
      if (result.hasOwnProperty(i)) {
        const data = result[i];
        const newResult = deproxifyResult(callGeneration, data, affected, false, deepDive);
        if (data && newResult !== nothing) {
          altered = true;
          sub[i] = newResult
        } else {
          sub[i] = data;
        }
      }
    }
    if (altered) {
      return sub;
    }
    return returnPureValue ? result : nothing;
  }

  return returnPureValue ? result : nothing;
}

export function callIn(that, cache, args, func, memoizationDepth, proxyMap = []) {
  const proxies = args.map((arg, index) => {
    if (arg && typeof arg === 'object') {
      const map = proxyMap[index];
      if (!map) {
        return proxyMap[index] = proxyState(arg, {callGeneration:proxyMap,index});
      }
      map.reset();
      return map.replaceState(arg);
    }
    return undefined
  });
  const callArgs = args.map((arg, index) => proxies[index] ? proxies[index].state : arg);

  //call the real function
  const preResult = func.call(that, ...callArgs);
  proxies.forEach(proxy => proxy && proxy.seal())

  let spreadDetected = [];
  const affected = proxies
    .map(proxy => {
      if (proxy) {
        if (proxy.spreadDetected !== false) {
          spreadDetected.push(proxy.spreadDetected);
        }
        const affected = proxy.affected || emptyArray;

        return {
          useAffected: [...affected],
          resultAffected: []
        };
      }
      return undefined;
    });
  const result = deproxifyResult(proxyMap, preResult, affected, true);
  const cacheLine = {args, affected, result, callArgs};
  if (cache.length < memoizationDepth) {
    cache.push(cacheLine)
  } else {
    updateCacheLine(cache, 0, cacheLine);
  }

  if (spreadDetected.length > 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        'memoize-state: object spread detected in ', func,
        '. Keys affected: ', spreadDetected.map(key => key ? key : 'root'),
        '. This is no-op.'
      );
    }
  }

  return result;
}