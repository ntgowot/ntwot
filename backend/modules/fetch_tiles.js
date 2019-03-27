var url = require("url");

function generateDiag(text, tileX, tileY) {
    var str = "";
    for(var y = 0; y < CONST.tileRows; y++) {
        for(var x = 0; x < CONST.tileCols; x++) {
            var posX = tileX * CONST.tileCols + x;
            var posY = tileY * CONST.tileRows + y;
            var ind = posX + posY;
            var len = text.length;
            var charPos = ind - Math.floor(ind / len) * len
            str += text.charAt(charPos);
        }
    }
    return {
        content: str,
        properties: {
            writability: 2
        }
    };
}

var surrogateRegexStr = "([\\uD800-\\uDBFF][\\uDC00-\\uDFFF])";
var surrogateRegex = new RegExp(surrogateRegexStr, "g");
var combiningRegexStr = "(([\\0-\\u02FF\\u0370-\\u1DBF\\u1E00-\\u20CF\\u2100-\\uD7FF\\uDC00-\\uFE1F\\uFE30-\\uFFFF]|[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]|[\\uD800-\\uDBFF])([\\u0300-\\u036F\\u1DC0-\\u1DFF\\u20D0-\\u20FF\\uFE20-\\uFE2F]+))";
var combiningRegex = new RegExp(combiningRegexStr, "g");
var splitRegex = new RegExp(surrogateRegexStr + "|" + combiningRegexStr + "|.|\\n|\\r", "g");
function advancedSplit(str, noSurrog, noComb) {
    str += "";
    // look for surrogate pairs first. then look for combining characters. finally, look for the rest
	var data = str.match(splitRegex)
    if(data == null) return [];
    for(var i = 0; i < data.length; i++) {
        // contains surrogates without second character?
        if(data[i].match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g)) {
            data.splice(i, 1)
        }
        if(noSurrog && data[i].match(surrogateRegex)) {
            data[i] = "?";
        }
        if(noComb && data[i].match(combiningRegex)) {
            data[i] = data[i].charAt(0);
        }
    }
	return data;
}
function filterUTF16(str) {
    return advancedSplit(str, true, true).join("");
}

module.exports = async function(data, vars) {
    var db = vars.db;
    var user = vars.user;
    var san_nbr = vars.san_nbr;
    var xrange = vars.xrange;
    var world = vars.world;
    var timemachine = vars.timemachine;
    if(!timemachine) timemachine = {};

    var tiles = {};
    var editLimit = 100000; // don't overload server
    var fetchRectLimit = 50;
    var totalAreaLimit = 5000;

    var len = data.fetchRectangles.length
    if(len >= fetchRectLimit) len = fetchRectLimit;
    var q_utf16 = data.utf16;
    var q_array = data.array;
    var q_content_only = data.content_only;

    var total_area = 0;
    for(var v = 0; v < len; v++) {
        var rect = data.fetchRectangles[v];
        var minY = san_nbr(rect.minY);
        var minX = san_nbr(rect.minX);
        var maxY = san_nbr(rect.maxY);
        var maxX = san_nbr(rect.maxX);

        var tmp;
        if(minX > maxX) {
            tmp = minX;
            minX = maxX;
            maxX = tmp;
        }
        if(minY > maxY) {
            tmp = minY;
            minY = maxY;
            maxY = tmp;
        }
        
        var area = Math.abs(maxY - minY + 1) * Math.abs(maxX - minX + 1);
        if(area > 50 * 50) {
            return "Too many tiles";
        }

        total_area += area;

        if(total_area > totalAreaLimit) {
            return "Too many tiles";
        }

        rect.minY = minY;
        rect.minX = minX;
        rect.maxY = maxY;
        rect.maxX = maxX;
    }

    for(var i = 0; i < len; i++) {
        var rect = data.fetchRectangles[i];
        var minY = rect.minY;
        var minX = rect.minX;
        var maxY = rect.maxY;
        var maxX = rect.maxX;

        for(var ty = minY; ty <= maxY; ty++) {
            for(var tx = minX; tx <= maxX; tx++) {
                tiles[ty + "," + tx] = null;
            }
        }

        if(timemachine.active) {
            var dr1 = await db.get("SELECT time FROM edit WHERE world_id=? LIMIT 1",
                world.id);
            var dr2 = await db.get("SELECT time FROM edit WHERE world_id=? ORDER BY id DESC LIMIT 1",
                world.id);
            var editCount = await db.get("SELECT count(id) AS cnt FROM edit WHERE world_id=?", world.id);
            editCount = editCount.cnt;
            if((!dr1 || !dr2) || editCount >= editLimit) {
                // diagonal text...
                var e_str = "Cannot view timemachine: There are no edits yet. | ";
                if(editCount >= editLimit) {
                    e_str = "There are too many edits in this world. | ";
                }
                for (var ty in YTileRange) {
                    for (var tx in XTileRange) {
                        var tileX = XTileRange[tx];
                        var tileY = YTileRange[ty];
                        tiles[tileY + "," + tileX] = generateDiag(e_str, tileX, tileY);
                    }
                }
                continue;
            }

            dr1 = dr1.time;
            dr2 = dr2.time;

            var time = timemachine.time;
            if(!time) {
                time = Date.now();
            } else {
                var range = dr2 - dr1;
                var div = range / 1000000;
                time = Math.floor(div * timemachine.time) + dr1;
            }

            await db.each("SELECT * FROM edit WHERE world_id=? AND time <= ? AND tileY >= ? AND tileX >= ? AND tileY <= ? AND tileX <= ?",
                [world.id, time, minY, minX, maxY, maxX], function(data) {
                if(data.content.charAt(0) == "@") return;
                var con = JSON.parse(data.content);
                for(var q in con) {
                    var z = con[q]
                    if(!tiles[z[0] + "," + z[1]]) {
                        tiles[z[0] + "," + z[1]] = {
                            content: " ".repeat(CONST.tileArea).split(""),
                            properties: {
                                writability: 2
                            }
                        };
                    };
                    var tile_r = tiles[z[0] + "," + z[1]];
                    var index_r = z[2]*CONST.tileCols+z[3];
                    tile_r.content[index_r] = z[5]
                    var color = z[7];
                    if(!color) color = 0;
                    if(typeof color != "number") color = 0;
                    if(color) {
                        if(!tile_r.properties.color) {
                            tile_r.properties.color = new Array(CONST.tileArea).fill(0);
                        }
                        tile_r.properties.color[index_r] = color;
                    }
                }
            });

            for(var z in tiles) {
                if(tiles[z]) {
                    if(typeof tiles[z].content == "object") tiles[z].content = tiles[z].content.join("");
                }
            }
        } else {
            await db.each("SELECT * FROM tile WHERE world_id=? AND tileY >= ? AND tileX >= ? AND tileY <= ? AND tileX <= ?", 
                [world.id, minY, minX, maxY, maxX], function(data) {
                var properties = JSON.parse(data.properties);
                var content = data.content;
                if(q_utf16) content = filterUTF16(content);
                if(q_array) content = advancedSplit(content);
                var tileRes;
                if(q_content_only) {
                    tileRes = content;
                } else {
                    tileRes = {
                        content,
                        properties: Object.assign(properties, {
                            writability: data.writability
                        })
                    };
                }
                tiles[data.tileY + "," + data.tileX] = tileRes;
            });
        }
    }

    return tiles;
}