# convert to PEC-like
open F,"<:utf8","c.txt"; my @ev;
while(<F>){ s/\x{feff}//g; next unless /\S/; my @p=split; push @ev,[$p[0],$p[2]+0,$p[3]+0,$p[4]+0,$p[5]+0,$p[6]+0]; }
my %type = (n1=>'Note', n2=>'Hold', n3=>'Flick', n4=>'Drag');
# lines: distinct x at a time; assign line id by x
my %xid; my $i=0;
my @notes;
for my $e (sort {$a->[1]<=>$b->[1]} @ev){
  my $x=sprintf("%.4f",$e->[3]); $xid{$x} //= $i++;
}
print "lines used as separate lineIDs: $i\n";
my @s = sort {$a->[1]<=>$b->[1] || $a->[3]<=>$b->[3]} @ev;
for my $e (@s[0..19]){ printf "%s x=%.2f start=%.3f end=%.3f dir=%d\n",$e->[0],$e->[3],$e->[1],$e->[2],$e->[4]; }
